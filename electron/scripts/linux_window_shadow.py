"""Supply native X11 rounded corners and compositor shadow tiles.

Protocol: https://community.kde.org/KWin/Shadow
Only Python's standard library and the desktop's libX11 are required. Keep this
connection alive until stdin closes so the compositor can still read pixmaps.
"""
import ctypes as C
import ctypes.util
import math
import os
import select
import sys


CORNER_RADIUS = 14


def rounded_rectangles(width, height, radius):
    """X Shape rectangles for hit testing only; Chromium paints smooth edges."""
    radius = max(0, min(round(radius), width // 2, height // 2))
    if not radius:
        return [(0, 0, width, height)]
    rows = []
    for y in range(radius):
        inset = max(0, math.ceil(radius - math.sqrt(radius ** 2 - (radius - y - .5) ** 2) - .5))
        rows.append((inset, y, width - 2 * inset, 1))
    middle = [(0, radius, width, height - 2 * radius)] if height > 2 * radius else []
    return rows + middle + [(x, height - y - 1, w, h) for x, y, w, h in reversed(rows)]


def shadow_tiles(scale=1.0):
    scale = max(1.0, min(4.0, float(scale)))
    sigma = 26 * scale
    offset = 16 * scale
    radius = round(CORNER_RADIUS * scale)
    side = math.ceil(3 * sigma)
    top = math.ceil(3 * sigma - offset)
    bottom = math.ceil(3 * sigma + offset)
    margins = (top, side, bottom, side)
    # Include the shifted silhouette inside the corner tiles so their
    # junctions with the straight edges lie beyond the rounded quadrant.
    horizontal_inset = radius + math.ceil(2 * offset)
    upper_inset = horizontal_inset + math.ceil(offset)
    lower_inset = horizontal_inset - math.ceil(offset)

    def alpha(distance):
        # Blur the window silhouette instead of painting a dense ring along
        # its outline. A half-plane Gaussian integral keeps fading through
        # the edge; the downward offset makes the upper edge lighter.
        return round(64 * .5 * math.erfc(distance / (math.sqrt(2) * sigma)))

    # Top, top-right, right, bottom-right, bottom, bottom-left, left, top-left.
    specs = [(1, top + upper_inset, 0, -1), (side + horizontal_inset, top + upper_inset, 1, -1),
             (side + horizontal_inset, 1, 1, 0), (side + horizontal_inset, bottom + lower_inset, 1, 1),
             (1, bottom + lower_inset, 0, 1), (side + horizontal_inset, bottom + lower_inset, -1, 1),
             (side + horizontal_inset, 1, -1, 0), (side + horizontal_inset, top + upper_inset, -1, -1)]
    tiles = []
    for width, height, sx, sy in specs:
        pixels = []
        for y in range(height):
            row = []
            for x in range(width):
                dx = (x + .5 if sx > 0 else width - x - .5) if sx else 0
                dy = (y + .5 if sy > 0 else height - y - .5) if sy else 0
                if sx:
                    dx += radius - horizontal_inset
                if sy:
                    dy += radius - (upper_inset if sy < 0 else lower_inset) - sy * offset
                if sx and sy:
                    # Signed distance to a rounded quadrant. Inside the
                    # radius the distance stays negative, without a flat
                    # opacity band; corners join the adjacent edge tiles.
                    distance = (math.hypot(max(dx, 0), max(dy, 0))
                                + min(max(dx, dy), 0) - radius)
                else:
                    distance = dx + dy - radius
                row.append(alpha(distance))
            pixels.append(row)
        tiles.append((width, height, pixels))
    return margins, tiles


class X11:
    def __init__(self):
        self.lib = C.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
        p, u, i = C.c_void_p, C.c_ulong, C.c_int
        definitions = {
            "XOpenDisplay": (p, [C.c_char_p]), "XCloseDisplay": (i, [p]),
            "XDefaultRootWindow": (u, [p]), "XInternAtom": (u, [p, C.c_char_p, i]),
            "XGetWindowProperty": (i, [p, u, u, C.c_long, C.c_long, i, u,
                C.POINTER(u), C.POINTER(i), C.POINTER(u), C.POINTER(u), C.POINTER(p)]),
            "XGetGeometry": (i, [p, u, C.POINTER(u), C.POINTER(i), C.POINTER(i),
                C.POINTER(C.c_uint), C.POINTER(C.c_uint), C.POINTER(C.c_uint), C.POINTER(C.c_uint)]),
            "XCreatePixmap": (u, [p, u, C.c_uint, C.c_uint, C.c_uint]),
            "XFreePixmap": (i, [p, u]), "XCreateGC": (p, [p, u, u, p]),
            "XFreeGC": (i, [p, p]), "XSetForeground": (i, [p, p, u]),
            "XFillRectangle": (i, [p, u, p, i, i, C.c_uint, C.c_uint]),
            "XChangeProperty": (i, [p, u, u, u, i, i, p, i]),
            "XDeleteProperty": (i, [p, u, u]), "XSync": (i, [p, i]),
            "XFree": (i, [p]),
            "XSelectInput": (i, [p, u, C.c_long]),
            "XConnectionNumber": (i, [p]), "XPending": (i, [p]),
            "XNextEvent": (i, [p, p]),
        }
        for name, (restype, argtypes) in definitions.items():
            fn = getattr(self.lib, name)
            fn.restype, fn.argtypes = restype, argtypes
        self.error = 0
        # A window may close during setup/cleanup, and Wayland handles aren't XIDs.
        # Isolate X errors in this helper; never let them terminate the app.
        class XErrorEvent(C.Structure):
            _fields_ = [("type", i), ("display", p), ("resourceid", u),
                        ("serial", u), ("error_code", C.c_ubyte),
                        ("request_code", C.c_ubyte), ("minor_code", C.c_ubyte)]
        callback = C.CFUNCTYPE(i, p, C.POINTER(XErrorEvent))

        def on_error(_display, event):
            self.error = event.contents.error_code
            return 0
        self.error_handler = callback(on_error)
        self.lib.XSetErrorHandler.argtypes = [callback]
        self.lib.XSetErrorHandler.restype = p
        self.lib.XSetErrorHandler(self.error_handler)
        self.display = self.lib.XOpenDisplay(None)
        if not self.display:
            raise RuntimeError("cannot open X11 display")

    def atom(self, name):
        return self.lib.XInternAtom(self.display, name.encode(), 0)

    def property(self, window, atom):
        actual, count, remaining = C.c_ulong(), C.c_ulong(), C.c_ulong()
        fmt, data = C.c_int(), C.c_void_p()
        self.lib.XGetWindowProperty(self.display, window, atom, 0, 4096, 0, 0,
                                   C.byref(actual), C.byref(fmt), C.byref(count),
                                   C.byref(remaining), C.byref(data))
        try:
            if not data or fmt.value != 32:
                return []
            return list(C.cast(data, C.POINTER(C.c_ulong))[:count.value])
        finally:
            if data:
                self.lib.XFree(data)

    def geometry_for(self, window):
        root, x, y = C.c_ulong(), C.c_int(), C.c_int()
        width, height, border, depth = (C.c_uint() for _ in range(4))
        ok = self.lib.XGetGeometry(self.display, window, C.byref(root), C.byref(x), C.byref(y),
                                  C.byref(width), C.byref(height), C.byref(border), C.byref(depth))
        self.sync()
        if not ok:
            raise RuntimeError("window is not an X11 window")
        return root.value, width.value, height.value

    def root_for(self, window):
        return self.geometry_for(window)[0]

    def sync(self):
        self.lib.XSync(self.display, 0)
        if self.error:
            code, self.error = self.error, 0
            raise RuntimeError(f"X11 error {code}")


class RoundedShape:
    def __init__(self, x):
        self.x = x
        self.last_geometry = None
        self.lib = None
        try:
            lib = C.CDLL(ctypes.util.find_library("Xext") or "libXext.so.6")
            lib.XShapeQueryExtension.argtypes = [C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_int)]
            event, error = C.c_int(), C.c_int()
            if not lib.XShapeQueryExtension(x.display, C.byref(event), C.byref(error)):
                print("rounded corners unavailable: X11 Shape extension missing", file=sys.stderr, flush=True)
                return
            class Rectangle(C.Structure):
                _fields_ = [("x", C.c_short), ("y", C.c_short),
                            ("width", C.c_ushort), ("height", C.c_ushort)]
            self.Rectangle = Rectangle
            lib.XShapeCombineRectangles.argtypes = [C.c_void_p, C.c_ulong, C.c_int,
                C.c_int, C.c_int, C.POINTER(Rectangle), C.c_int, C.c_int, C.c_int]
            lib.XShapeCombineMask.argtypes = [C.c_void_p, C.c_ulong, C.c_int,
                                            C.c_int, C.c_int, C.c_ulong, C.c_int]
            self.lib = lib
        except (OSError, AttributeError) as error:
            print(f"rounded corners unavailable: {error}", file=sys.stderr, flush=True)

    def apply(self, window, width, height, radius):
        key = width, height, radius
        if not self.lib or key == self.last_geometry:
            return
        if not radius:
            self.reset(window)
            self.last_geometry = key
            return
        rectangles = rounded_rectangles(width, height, radius)
        values = (self.Rectangle * len(rectangles))(*(self.Rectangle(*r) for r in rectangles))
        # ShapeInput (2) excludes only the corner cutouts from hit testing.
        # Never shape the bounding region: its binary mask destroys antialiasing.
        self.lib.XShapeCombineRectangles(self.x.display, window, 2, 0, 0,
                                        values, len(rectangles), 0, 0)
        self.x.sync()
        self.last_geometry = key

    def reset(self, window):
        if self.lib:
            # None removes the mask entirely, so future resizing remains normal.
            self.lib.XShapeCombineMask(self.x.display, window, 2, 0, 0, 0, 0)
            self.x.sync()
            self.last_geometry = None


def run(window, scale):
    x = X11()
    pixmaps = []
    atom = x.atom("_KDE_NET_WM_SHADOW")
    submitted = False
    shape = None
    destroyed = False
    try:
        root = x.root_for(window)
        supports_shadow = atom in x.property(root, x.atom("_NET_SUPPORTED"))
        if not supports_shadow:
            print("desktop does not advertise native shadow support", flush=True)
        shape = RoundedShape(x)
        margins, tiles = shadow_tiles(scale)
        for width, height, pixels in tiles if supports_shadow else []:
            pixmap = x.lib.XCreatePixmap(x.display, root, width, height, 32)
            pixmaps.append(pixmap)
            gc = x.lib.XCreateGC(x.display, pixmap, 0, None)
            try:
                for row, values in enumerate(pixels):
                    for col, opacity in enumerate(values):
                        # Premultiplied black ARGB, including fully transparent pixels.
                        x.lib.XSetForeground(x.display, gc, opacity << 24)
                        x.lib.XFillRectangle(x.display, pixmap, gc, col, row, 1, 1)
            finally:
                x.lib.XFreeGC(x.display, gc)
        x.sync()
        values = (C.c_ulong * 12)(*pixmaps, *margins) if supports_shadow else None
        # Also observe native state: desktop shortcuts can toggle fullscreen
        # without Electron emitting enter-full-screen/leave-full-screen.
        state_atom = x.atom("_NET_WM_STATE")
        fullscreen = x.atom("_NET_WM_STATE_FULLSCREEN")
        maximized = {x.atom("_NET_WM_STATE_MAXIMIZED_VERT"),
                     x.atom("_NET_WM_STATE_MAXIMIZED_HORZ")}
        x.lib.XSelectInput(x.display, window, (1 << 22) | (1 << 17))
        x.sync()
        requested_visible = False
        last_visible = None

        def update():
            nonlocal submitted, last_visible
            states = set(x.property(window, state_atom))
            visible = requested_visible and fullscreen not in states and not maximized.issubset(states)
            _, width, height = x.geometry_for(window)
            shape.apply(window, width, height, round(CORNER_RADIUS * max(1, min(4, scale))) if visible else 0)
            if visible == last_visible:
                return
            if visible and supports_shadow:
                x.lib.XChangeProperty(x.display, window, atom, x.atom("CARDINAL"),
                                      32, 0, values, 12)
                submitted = True
            elif supports_shadow:
                x.lib.XDeleteProperty(x.display, window, atom)
                submitted = False
            x.sync()
            last_visible = visible
            status = []
            if visible:
                if shape.lib:
                    status.append("rounded corners applied")
                if supports_shadow:
                    status.append("shadow tiles submitted")
            else:
                status.append("corners restored to rectangle; shadow removed")
            if status:
                print("; ".join(status), flush=True)

        class XPropertyEvent(C.Structure):
            _fields_ = [("type", C.c_int), ("serial", C.c_ulong), ("send_event", C.c_int),
                        ("display", C.c_void_p), ("window", C.c_ulong), ("atom", C.c_ulong)]

        event = (C.c_long * 24)()
        buffer = b""
        stdin_fd = sys.stdin.fileno()
        display_fd = x.lib.XConnectionNumber(x.display)
        while True:
            while x.lib.XPending(x.display):
                x.lib.XNextEvent(x.display, event)
                kind = C.cast(event, C.POINTER(C.c_int)).contents.value
                if kind == 17:  # DestroyNotify: no further window requests.
                    submitted = False
                    destroyed = True
                    return
                if kind == 28 and C.cast(event, C.POINTER(XPropertyEvent)).contents.atom == state_atom:
                    update()
                elif kind == 22:  # ConfigureNotify: keep the mask aligned during resize.
                    update()
            ready, _, _ = select.select([stdin_fd, display_fd], [], [])
            if stdin_fd in ready:
                chunk = os.read(stdin_fd, 4096)
                if not chunk:
                    break
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    requested_visible = line.strip() == b"show"
                    update()
    finally:
        if shape and not destroyed:
            try:
                shape.reset(window)
            except RuntimeError:
                pass  # The window may already have closed.
        if submitted:
            x.lib.XDeleteProperty(x.display, window, atom)
        for pixmap in pixmaps:
            x.lib.XFreePixmap(x.display, pixmap)
        x.lib.XCloseDisplay(x.display)


if __name__ == "__main__":
    try:
        run(int(sys.argv[1]), float(sys.argv[2]))
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)

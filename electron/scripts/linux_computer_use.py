#!/usr/bin/env python3
import json
import subprocess
import sys


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


try:
    import pyatspi
except Exception as error:
    emit({
        "ok": False,
        "error": "无法加载系统无障碍接口 python3-pyatspi：%s" % error,
    })
    raise SystemExit(0)


def safe(callable_value, default=None):
    try:
        return callable_value()
    except Exception:
        return default


def norm(value):
    return str(value or "").strip().casefold()


def accessible_name(accessible):
    return safe(lambda: accessible.name, "") or ""


def descendants(root, limit=600):
    stack = [root]
    index = 0
    while stack and index < limit:
        current = stack.pop()
        yield index, current
        index += 1
        children = []
        count = safe(lambda: current.childCount, 0) or 0
        for child_index in range(min(count, 300)):
            child = safe(lambda child_index=child_index: current.getChildAtIndex(child_index))
            if child is not None:
                children.append(child)
        stack.extend(reversed(children))


def app_haystack(application):
    values = [accessible_name(application)]
    for _, item in descendants(application, 80):
        role = safe(lambda item=item: item.getRoleName(), "") or ""
        if role in ("frame", "dialog", "window"):
            values.append(accessible_name(item))
    return " ".join(values)


def find_application(queries):
    desktop = pyatspi.Registry.getDesktop(0)
    applications = [
        safe(lambda index=index: desktop.getChildAtIndex(index))
        for index in range(safe(lambda: desktop.childCount, 0) or 0)
    ]
    applications = [item for item in applications if item is not None]
    needles = [norm(item) for item in queries if norm(item)]
    scored = []
    for application in applications:
        haystack = norm(app_haystack(application))
        score = max((100 if needle == norm(accessible_name(application))
                     else 50 if needle in haystack
                     else 0) for needle in needles) if needles else 1
        scored.append((score, application))
    scored.sort(key=lambda item: item[0], reverse=True)
    if scored and scored[0][0] > 0:
        return scored[0][1], [accessible_name(item) for item in applications]
    return None, [accessible_name(item) for item in applications]


def find_window_root(application, expected_title):
    needle = norm(expected_title)
    if not needle:
        raise RuntimeError("缺少目标窗口标题，已停止无障碍操作以避免选错文档")
    candidates = []
    for _, item in descendants(application):
        role = safe(lambda item=item: item.getRoleName(), "") or ""
        if role not in ("frame", "dialog", "window"):
            continue
        name = accessible_name(item)
        candidates.append((item, name))
    exact = [item for item, name in candidates if norm(name) == needle]
    if len(exact) == 1:
        return exact[0]
    partial = [
        item for item, name in candidates
        if needle in norm(name) or norm(name) in needle
    ]
    if len(partial) == 1:
        return partial[0]
    available = "、".join(name for _, name in candidates if name)
    if len(exact) > 1 or len(partial) > 1:
        raise RuntimeError("无障碍接口中有多个同名窗口，已停止操作：%s" % expected_title)
    raise RuntimeError(
        "无障碍接口中没有找到目标窗口“%s”。当前窗口：%s" %
        (expected_title, available or "无")
    )


def element_at(root, raw_index):
    text = str(raw_index or "").strip().lower()
    if text.startswith("e"):
        text = text[1:]
    try:
        target = int(text)
    except ValueError:
        raise RuntimeError("控件编号无效：%s" % raw_index)
    for index, element in descendants(root):
        if index == target:
            return element
    raise RuntimeError("没有找到控件：e%d。请重新读取应用状态。" % target)


def action_names(element):
    interface = safe(lambda: element.queryAction())
    if interface is None:
        return []
    count = safe(lambda: interface.nActions, 0) or 0
    return [
        safe(lambda index=index: interface.getName(index), "") or ""
        for index in range(count)
    ]


def bounds_of(element):
    component = safe(lambda: element.queryComponent())
    if component is None:
        return None
    extents = safe(lambda: component.getExtents(pyatspi.DESKTOP_COORDS))
    if extents is None:
        return None
    return {
        "x": int(extents.x),
        "y": int(extents.y),
        "width": int(extents.width),
        "height": int(extents.height),
    }


def text_of(element, limit=500):
    interface = safe(lambda: element.queryText())
    if interface is None:
        return ""
    count = safe(lambda: interface.characterCount, 0) or 0
    return safe(lambda: interface.getText(0, min(count, limit)), "") or ""


def value_of(element):
    interface = safe(lambda: element.queryValue())
    if interface is None:
        return ""
    value = safe(lambda: interface.currentValue)
    return "" if value is None else str(value)


def description_of(element):
    return safe(lambda: element.description, "") or ""


def describe(root):
    lines = ["可操作控件（操作后必须重新读取状态）："]
    for index, element in descendants(root):
        role = safe(lambda element=element: element.getRoleName(), "") or ""
        name = accessible_name(element).replace("\n", " ").strip()
        actions = [item for item in action_names(element) if item]
        bounds = bounds_of(element)
        value = value_of(element)
        text = text_of(element, 220).replace("\n", " ").strip()
        desc = description_of(element).replace("\n", " ").strip()
        if not (name or desc or actions or value or text or role in ("frame", "dialog", "entry", "button", "menu item", "check box", "combo box")):
            continue
        details = ["[e%d]" % index, role or "unknown"]
        if name:
            details.append('"%s"' % name[:240])
        if desc and desc != name and desc != text:
            details.append('desc="%s"' % desc[:160])
        if value:
            details.append("value=%s" % value[:120])
        if text and text != name and text != desc:
            details.append('text="%s"' % text[:220])
        if bounds and bounds["width"] > 0 and bounds["height"] > 0:
            details.append(
                "bounds=(%d,%d,%d,%d)" %
                (bounds["x"], bounds["y"], bounds["width"], bounds["height"])
            )
        if actions:
            details.append("actions=%s" % ",".join(actions))
        lines.append(" ".join(details))
        if len(lines) >= 360:
            lines.append("…控件较多，已截断")
            break
    return "\n".join(lines)


def click_element(element):
    interface = safe(lambda: element.queryAction())
    if interface is not None:
        names = action_names(element)
        preferred = ("click", "press", "activate", "open")
        selected = next(
            (index for index, name in enumerate(names) if norm(name) in preferred),
            0 if names else None,
        )
        if selected is not None and safe(lambda: interface.doAction(selected), False):
            return
    bounds = bounds_of(element)
    if not bounds or bounds["width"] <= 0 or bounds["height"] <= 0:
        raise RuntimeError("该控件没有可点击动作或有效位置")
    x = bounds["x"] + bounds["width"] // 2
    y = bounds["y"] + bounds["height"] // 2
    subprocess.run(["xdotool", "mousemove", "--sync", str(x), str(y), "click", "1"], check=True)


def secondary_action(element, requested):
    interface = element.queryAction()
    names = action_names(element)
    target = norm(requested)
    for index, name in enumerate(names):
        if norm(name) == target:
            if not interface.doAction(index):
                raise RuntimeError("控件拒绝执行动作：%s" % requested)
            return
    raise RuntimeError("控件不提供动作“%s”，可用动作：%s" % (requested, "、".join(names) or "无"))


def set_value(element, value):
    editable = safe(lambda: element.queryEditableText())
    if editable is not None:
        editable.setTextContents(str(value))
        return
    value_interface = safe(lambda: element.queryValue())
    if value_interface is not None:
        value_interface.currentValue = float(value)
        return
    raise RuntimeError("该控件不支持直接设置内容")


def select_text(element, payload):
    interface = element.queryText()
    content = interface.getText(0, interface.characterCount)
    target = str(payload.get("text") or "")
    prefix = str(payload.get("prefix") or "")
    suffix = str(payload.get("suffix") or "")
    search = prefix + target + suffix
    found = content.find(search)
    if found < 0:
        raise RuntimeError("控件中没有找到指定文字")
    start = found + len(prefix)
    end = start + len(target)
    selection = payload.get("selection") or "text"
    if selection == "cursor_before":
        interface.setCaretOffset(start)
    elif selection == "cursor_after":
        interface.setCaretOffset(end)
    else:
        interface.addSelection(start, end)


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        queries = [payload.get("app")] + list(payload.get("hints") or [])
        application, available = find_application(queries)
        if application is None:
            emit({
                "ok": False,
                "error": "系统无障碍接口中没有找到目标应用。当前应用：%s" % "、".join(filter(None, available)),
            })
            return
        window_root = find_window_root(application, payload.get("window_title"))
        command = payload.get("command") or "state"
        if command == "state":
            emit({"ok": True, "text": describe(window_root)})
            return
        element = element_at(window_root, payload.get("element_index"))
        if command == "click":
            click_element(element)
        elif command == "secondary":
            secondary_action(element, payload.get("action") or "")
        elif command == "set_value":
            set_value(element, payload.get("value") or "")
        elif command == "select_text":
            select_text(element, payload)
        elif command == "bounds":
            bounds = bounds_of(element)
            if not bounds:
                raise RuntimeError("控件没有有效位置")
            emit({
                "ok": True,
                "x": bounds["x"] + bounds["width"] // 2,
                "y": bounds["y"] + bounds["height"] // 2,
            })
            return
        else:
            raise RuntimeError("未知操作：%s" % command)
        emit({"ok": True})
    except Exception as error:
        emit({"ok": False, "error": str(error)})


main()

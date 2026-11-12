#!/usr/bin/env python3
import json
import hashlib
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


# ---------------------------------------------------------------------------
# 控件引用绑定：用「路径指纹 + 预期属性」替代裸序号，防止控件树变化后误操作
# ---------------------------------------------------------------------------

def element_signature(element):
    """生成控件的身份指纹：角色 + 名称 + 在父节点中的序号 + 父节点角色。"""
    role = safe(lambda: element.getRoleName(), "") or ""
    name = accessible_name(element)
    parent = safe(lambda: element.getParent())
    parent_role = safe(lambda: parent.getRoleName(), "") if parent else ""
    index_in_parent = -1
    if parent:
        count = safe(lambda: parent.childCount, 0) or 0
        for index in range(min(count, 500)):
            child = safe(lambda index=index: parent.getChildAtIndex(index))
            if child == element:
                index_in_parent = index
                break
    return {
        "role": role,
        "name": name,
        "parent_role": parent_role or "",
        "index_in_parent": index_in_parent,
    }


def signature_matches(element, expected):
    """核对控件当前指纹与观察时记录的指纹是否一致。"""
    if not expected or not isinstance(expected, dict):
        return False
    if not all(key in expected and isinstance(expected[key], str) for key in ("role", "name", "parent_role")):
        return False
    if not isinstance(expected.get("index_in_parent"), int) or isinstance(expected["index_in_parent"], bool) or expected["index_in_parent"] < 0:
        return False
    current = element_signature(element)
    for key in ("role", "name", "parent_role"):
        if key in expected and norm(expected[key]) != norm(current.get(key)):
            return False
    expected_index = expected.get("index_in_parent")
    if current["index_in_parent"] != expected_index:
        return False
    return True


def descendants(root, limit=600, with_path=False):
    stack = [(root, ())]
    index = 0
    while stack and index < limit:
        current, path = stack.pop()
        yield (index, current, path) if with_path else (index, current)
        index += 1
        children = []
        parent_role = (safe(lambda: current.getRoleName(), "") or "") if with_path else ""
        parent_name = accessible_name(current) if with_path else ""
        count = safe(lambda: current.childCount, 0) or 0
        for child_index in range(min(count, 300)):
            child = safe(lambda child_index=child_index: current.getChildAtIndex(child_index))
            if child is not None:
                children.append((child, path + ((child_index, parent_role, parent_name),) if with_path else ()))
        stack.extend(reversed(children))


def app_haystack(application):
    values = [accessible_name(application)]
    for _, item in descendants(application, 80):
        role = safe(lambda item=item: item.getRoleName(), "") or ""
        if role in ("frame", "dialog", "window"):
            values.append(accessible_name(item))
    return " ".join(values)


def find_application(queries, window_title="", expected_pid=None):
    desktop = pyatspi.Registry.getDesktop(0)
    applications = [
        safe(lambda index=index: desktop.getChildAtIndex(index))
        for index in range(safe(lambda: desktop.childCount, 0) or 0)
    ]
    applications = [item for item in applications if item is not None]
    if expected_pid is not None:
        pid = str(expected_pid)
        if not pid.isdigit() or int(pid) <= 0:
            raise RuntimeError("无法确认目标窗口所属应用，已停止操作。")
        applications = [item for item in applications if str(safe(lambda: item.get_process_id(), "")) == pid]
        if len(applications) != 1:
            raise RuntimeError("无法唯一确认目标窗口所属应用，已停止操作。")
    needles = [norm(item) for item in queries if norm(item)]
    scored = []
    for application in applications:
        haystack = norm(app_haystack(application))
        score = max((100 if needle == norm(accessible_name(application))
                     else 50 if needle in haystack
                     else 0) for needle in needles) if needles else 1
        scored.append((score, application))
    scored.sort(key=lambda item: item[0], reverse=True)
    available = [accessible_name(item) for item in applications]
    candidates = [(score, application) for score, application in scored if score > 0]
    if not candidates:
        return None, available
    # 先核对目标窗口，避免相同名称的多个应用实例因枚举顺序而选错。
    title = norm(window_title)
    matching = []
    if title:
        for _, application in candidates:
            if any(norm(safe(lambda: item.getRoleName(), "")) in ("frame", "dialog", "window")
                   and norm(accessible_name(item)) == title for _, item in descendants(application)):
                matching.append(application)
    if len(matching) == 1:
        return matching[0], available
    if len(matching) > 1:
        raise RuntimeError("多个应用实例包含同名目标窗口，无法确认所属实例，已停止操作。")
    if len(candidates) != 1:
        raise RuntimeError("多个应用实例匹配目标，无法确认所属实例，已停止操作。")
    return candidates[0][1], available


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


def element_at(root, raw_index, expected_signature=None):
    text = str(raw_index or "").strip().lower()
    if text.startswith("e"):
        text = text[1:]
    try:
        target = int(text)
    except ValueError:
        raise RuntimeError("控件编号无效：%s" % raw_index)
    for index, element, tree_path in descendants(root, with_path=True):
        if index == target:
            if (not isinstance(expected_signature, dict)
                    or not isinstance(expected_signature.get("tree_path"), list)
                    or expected_signature["tree_path"] != [list(part) for part in tree_path]
                    or not signature_matches(element, expected_signature)):
                raise RuntimeError(
                    "控件 e%d 的身份已经变化（角色或名称与读取时不一致），"
                    "已停止操作以避免误点。请重新读取应用状态。" % target
                )
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


def content_snapshot(element):
    # 密码不可读；普通控件只保留指纹，不把完整内容放入返回的界面文本。
    role = norm(safe(lambda: element.getRoleName(), ""))
    if "password" in role:
        return {"kind": "protected"}, ""
    text = safe(lambda: element.queryText())
    if text is not None:
        count = safe(lambda: text.characterCount)
        if not isinstance(count, int) or isinstance(count, bool) or count < 0 or count > 100000:
            return {"kind": "unavailable"}, text_of(element, 220)
        content = safe(lambda: text.getText(0, count))
        if not isinstance(content, str) or len(content) != count:
            return {"kind": "unavailable"}, ""
        return {"kind": "text", "digest": hashlib.sha256(content.encode("utf-8")).hexdigest()}, content[:220]
    number = safe(lambda: element.queryValue())
    if number is not None:
        value = safe(lambda: number.currentValue)
        if value is None:
            return {"kind": "unavailable"}, ""
        return {"kind": "number", "value": str(value)}, ""
    return {"kind": "unavailable"}, ""


def content_fingerprint(element):
    return content_snapshot(element)[0]


def selection_snapshot(element):
    if "password" in norm(safe(lambda: element.getRoleName(), "")):
        return None
    text = safe(lambda: element.queryText())
    if text is None:
        return None
    count = safe(lambda: text.characterCount)
    caret = safe(lambda: text.caretOffset)
    selections = safe(lambda: text.getNSelections())
    if any(not isinstance(v, int) or isinstance(v, bool) for v in (count, caret, selections)) or count < 0 or count > 100000 or caret < 0 or caret > count or selections not in (0, 1):
        return None
    selected = safe(lambda: tuple(text.getSelection(0))) if selections else (caret, caret)
    if not isinstance(selected, tuple) or len(selected) != 2 or any(not isinstance(v, int) or isinstance(v, bool) for v in selected):
        return None
    start, end = selected
    if start < 0 or end < start or end > count:
        return None
    return {"start": start, "end": end, "caret": caret}


def verify_observed_content(element, signature, command):
    if command not in ("set_value", "select_text", "replace_text", "insert_text"):
        return
    observed = signature.get("content_fingerprint") if isinstance(signature, dict) else None
    if not isinstance(observed, dict):
        raise RuntimeError("无法核对控件原内容，请重新读取应用状态。")
    if observed.get("kind") == "protected":
        if "password" not in norm(safe(lambda: element.getRoleName(), "")):
            raise RuntimeError("控件类型已变化，请重新读取应用状态。")
        return
    if observed.get("kind") not in ("text", "number"):
        raise RuntimeError("无法核对控件原内容，已停止操作。")
    if content_fingerprint(element) != observed:
        raise RuntimeError("控件内容已变化，已停止操作。请重新读取应用状态。")


def describe(root):
    lines = ["可操作控件（操作后必须重新读取状态）："]
    signatures = {}
    for index, element, tree_path in descendants(root, with_path=True):
        role = safe(lambda element=element: element.getRoleName(), "") or ""
        name = accessible_name(element).replace("\n", " ").strip()
        actions = [item for item in action_names(element) if item]
        bounds = bounds_of(element)
        protected = "password" in norm(role)
        fingerprint, snapshot_text = content_snapshot(element)
        value = "" if protected else fingerprint.get("value", "") if fingerprint.get("kind") == "number" else value_of(element)
        text = snapshot_text.replace("\n", " ").strip()
        desc = description_of(element).replace("\n", " ").strip()
        if not (name or desc or actions or value or text or role in ("frame", "dialog", "entry", "button", "menu item", "check box", "combo box")):
            continue
        signature = element_signature(element)
        signature["tree_path"] = [list(part) for part in tree_path]
        signature["content_fingerprint"] = fingerprint
        signature["selection_snapshot"] = selection_snapshot(element) if fingerprint.get("kind") == "text" else None
        signatures["e%d" % index] = signature
        details = ["[e%d]" % index, role or "unknown"]
        if name:
            details.append('"%s"' % name[:240])
        if desc and desc != name and desc != text:
            details.append('desc="%s"' % desc[:160])
        if value:
            details.append("value=%s" % value[:120])
        if text and text != name and text != desc:
            details.append('text="%s"' % text[:220])
        if signature["selection_snapshot"] is not None:
            selection = signature["selection_snapshot"]
            details.append("selection=(%d,%d)" % (selection["start"], selection["end"]))
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
    return "\n".join(lines), signatures


def click_element(element, background=True):
    interface = safe(lambda: element.queryAction())
    if interface is not None:
        names = action_names(element)
        preferred = ("click", "press", "activate", "open")
        selected = next(
            (index for index, name in enumerate(names) if norm(name) in preferred),
            0 if names and not background else None,
        )
        if selected is not None:
            if not interface.doAction(selected):
                raise RuntimeError("控件拒绝执行点击，请重新读取应用状态")
            return False
    if background:
        raise RuntimeError("该控件不支持后台点击，已停止，未使用系统鼠标。")
    return True


def secondary_action(element, requested, background=True):
    target = norm(requested)
    target_clean = re.sub(r"[-_\s]", "", target)
    if background and target_clean in {"menu", "showmenu", "openmenu", "popup", "popupmenu", "focus", "grabfocus", "raise", "activate", "axraise", "axfocus", "axshowmenu"}:
        raise RuntimeError("该动作可能显示菜单、切换或聚焦窗口，不能在后台执行。")
    interface = element.queryAction()
    names = action_names(element)
    for index, name in enumerate(names):
        if norm(name) == target:
            if not interface.doAction(index):
                raise RuntimeError("控件拒绝执行动作：%s" % requested)
            return
    raise RuntimeError("控件不提供动作“%s”，可用动作：%s" % (requested, "、".join(names) or "无"))


def set_value(element, value):
    editable = safe(lambda: element.queryEditableText())
    if editable is not None:
        wanted = str(value)
        if editable.setTextContents(wanted) is False:
            raise RuntimeError("应用拒绝设置控件内容，请重新读取应用状态。")
        role = norm(safe(lambda: element.getRoleName(), ""))
        if "password" not in role:
            interface = safe(lambda: element.queryText())
            if interface is not None:
                actual = safe(lambda: interface.getText(0, interface.characterCount))
                if actual != wanted:
                    raise RuntimeError("应用未确认设置的控件内容，请重新读取应用状态。")
        return
    value_interface = safe(lambda: element.queryValue())
    if value_interface is not None:
        wanted = float(value)
        value_interface.currentValue = wanted
        if safe(lambda: value_interface.currentValue) != wanted:
            raise RuntimeError("应用未确认设置的控件数值，请重新读取应用状态。")
        return
    raise RuntimeError("该控件不支持直接设置内容")


def select_text(element, payload):
    if "password" in norm(safe(lambda: element.getRoleName(), "")):
        raise RuntimeError("不能读取或选择密码控件中的文字。")
    interface = element.queryText()
    content = interface.getText(0, interface.characterCount)
    target = str(payload.get("text") or "")
    if not target:
        raise RuntimeError("需要提供要选择的原文")
    prefix = str(payload.get("prefix") or "")
    suffix = str(payload.get("suffix") or "")
    search = prefix + target + suffix
    matches = []
    found = content.find(search)
    while found >= 0:
        matches.append(found)
        found = content.find(search, found + 1)
    if len(matches) != 1:
        raise RuntimeError("原文不存在或有多处匹配，请重新观察并指定 prefix/suffix")
    found = matches[0]
    start = found + len(prefix)
    end = start + len(target)
    selection = payload.get("selection") or "text"
    if selection not in ("text", "cursor_before", "cursor_after"):
        raise RuntimeError("不支持的文字选择方式。")
    count = interface.getNSelections()
    if count not in (0, 1):
        raise RuntimeError("当前有多个选区，无法安全选择文字，请重新观察。")
    if selection == "cursor_before":
        result = interface.setCaretOffset(start)
    elif selection == "cursor_after":
        result = interface.setCaretOffset(end)
    elif count == 1:
        result = interface.setSelection(0, start, end)
    else:
        result = interface.addSelection(start, end)
    if result is False:
        raise RuntimeError("应用未确认文字选择，请重新观察")
    if selection == "text":
        if interface.getNSelections() != 1 or tuple(interface.getSelection(0)) != (start, end):
            raise RuntimeError("应用未确认所选文字范围，请重新观察。")
    else:
        wanted = start if selection == "cursor_before" else end
        if interface.caretOffset != wanted or interface.getNSelections() != 0:
            raise RuntimeError("应用未确认光标位置或仍保留选区，请重新观察。")


def replace_text(element, payload):
    if "password" in norm(safe(lambda: element.getRoleName(), "")):
        raise RuntimeError("不能读取或替换密码控件中的文字。")
    old_text, new_text = payload.get("old_text"), payload.get("new_text")
    if not isinstance(old_text, str) or not old_text or not isinstance(new_text, str):
        raise RuntimeError("替换文字需要非空原文和明确的新文字。")
    text = safe(lambda: element.queryText())
    editable = safe(lambda: element.queryEditableText())
    if text is None or editable is None:
        raise RuntimeError("该控件不支持直接替换文字。")
    count = safe(lambda: text.characterCount)
    if not isinstance(count, int) or isinstance(count, bool) or count < 0 or count > 100000:
        raise RuntimeError("无法核对完整原文，请重新读取应用状态。")
    original = safe(lambda: text.getText(0, count))
    observed = (payload.get("element_signature") or {}).get("content_fingerprint")
    if not isinstance(original, str) or len(original) != count or not isinstance(observed, dict) or observed.get("kind") != "text" or hashlib.sha256(original.encode("utf-8")).hexdigest() != observed.get("digest"):
        raise RuntimeError("控件原文已变化或无法核对，请重新读取应用状态。")
    prefix, suffix = str(payload.get("prefix") or ""), str(payload.get("suffix") or "")
    matches, start = [], 0
    while True:
        at = original.find(old_text, start)
        if at < 0:
            break
        if (not prefix or original[:at].endswith(prefix)) and (not suffix or original[at + len(old_text):].startswith(suffix)):
            matches.append(at)
        start = at + 1
    if len(matches) != 1:
        raise RuntimeError("原文不存在或有多处匹配，请重新观察并指定 prefix/suffix。")
    result = original[:matches[0]] + new_text + original[matches[0] + len(old_text):]
    if content_fingerprint(element) != observed:
        raise RuntimeError("控件原文已变化，请重新读取应用状态。")
    if result != original:
        set_value(element, result)


def insert_text(element, payload):
    if "password" in norm(safe(lambda: element.getRoleName(), "")):
        raise RuntimeError("不能读取或修改密码控件中的选区。")
    addition = payload.get("text")
    if not isinstance(addition, str):
        raise RuntimeError("需要明确提供插入文字。")
    if "\x00" in addition:
        raise RuntimeError("插入文字包含不支持的空字符，已停止操作。")
    text = safe(lambda: element.queryText())
    editable = safe(lambda: element.queryEditableText())
    if text is None or editable is None:
        raise RuntimeError("该控件不支持直接输入文字。")
    signature = payload.get("element_signature") or {}
    observed = signature.get("content_fingerprint")
    selection = signature.get("selection_snapshot")
    if not isinstance(observed, dict) or observed.get("kind") != "text" or content_fingerprint(element) != observed:
        raise RuntimeError("控件原文已变化或无法核对，请重新读取应用状态。")
    if not isinstance(selection, dict) or selection_snapshot(element) != selection:
        raise RuntimeError("选区已变化或无法确认，请重新读取应用状态。")
    count = text.characterCount
    original = text.getText(0, count)
    if not isinstance(original, str) or len(original) != count:
        raise RuntimeError("无法核对完整原文，请重新读取应用状态。")
    if hashlib.sha256(original.encode("utf-8")).hexdigest() != observed.get("digest"):
        raise RuntimeError("控件原文已变化或无法核对，请重新读取应用状态。")
    start, end = selection["start"], selection["end"]
    result = original[:start] + addition + original[end:]
    if content_fingerprint(element) != observed or selection_snapshot(element) != selection:
        raise RuntimeError("控件内容或选区已变化，请重新读取应用状态。")
    if result == original:
        return
    if start == end:
        if editable.insertText(start, addition, len(addition.encode("utf-8"))) is False:
            raise RuntimeError("应用未确认输入，请重新观察，不要直接重复输入。")
    else:
        # AT-SPI 不保证删除选区和插入文字原子完成；单次替换完整文字避免中途只删除。
        if editable.setTextContents(result) is False:
            raise RuntimeError("应用未确认输入，请重新观察，不要直接重复输入。")
    actual_count = safe(lambda: text.characterCount)
    if not isinstance(actual_count, int) or safe(lambda: text.getText(0, actual_count)) != result:
        raise RuntimeError("未能确认输入结果，请重新观察，不要直接重复输入。")


def find_linux_scroll_bar(element, vertical=True):
    queue = [element]
    visited = 0
    while queue and visited < 100:
        curr = queue.pop(0)
        visited += 1
        curr_role = norm(safe(lambda: curr.getRoleName(), ""))
        if "scrollbar" in curr_role:
            val = safe(lambda: curr.queryValue())
            if val is not None:
                return curr, val
        count = safe(lambda: curr.childCount, 0) or 0
        for i in range(min(count, 30)):
            child = safe(lambda: curr.getChildAtIndex(i))
            if child is not None:
                queue.append(child)
    parent = safe(lambda: element.parent)
    depth = 0
    while parent is not None and depth < 5:
        parent_role = norm(safe(lambda: parent.getRoleName(), ""))
        if "scroll" in parent_role:
            count = safe(lambda: parent.childCount, 0) or 0
            for i in range(count):
                child = safe(lambda: parent.getChildAtIndex(i))
                if child is not None and "scrollbar" in norm(safe(lambda: child.getRoleName(), "")):
                    val = safe(lambda: child.queryValue())
                    if val is not None:
                        return child, val
        parent = safe(lambda: parent.parent)
        depth += 1
    return None, None


def scroll_element(element, payload, background=True):
    direction = norm(payload.get("direction") or "down")
    vertical = direction in ("up", "down", "u", "d")
    forward = direction in ("down", "right", "d", "r")
    pages = float(payload.get("pages") or 1.0)

    sb_elem, val_interface = find_linux_scroll_bar(element, vertical)
    if val_interface is None:
        raise RuntimeError("目标控件或其所在容器未找到可供后台滚动的滚动条。")

    cur_val = safe(lambda: val_interface.currentValue)
    min_val = safe(lambda: val_interface.minimumValue, 0.0) or 0.0
    max_val = safe(lambda: val_interface.maximumValue, 100.0) or 100.0
    step = safe(lambda: val_interface.minimumIncrement, 10.0) or 10.0
    if step <= 0:
        step = (max_val - min_val) * 0.1
    delta = step * pages * 3.0

    if cur_val is None:
        raise RuntimeError("无法读取滚动条当前位置，应用可能已变化。")

    target_val = min(max_val, cur_val + delta) if forward else max(min_val, cur_val - delta)
    val_interface.currentValue = target_val
    after_val = safe(lambda: val_interface.currentValue)
    if after_val == cur_val:
        if forward and cur_val >= max_val - 0.001:
            return
        if not forward and cur_val <= min_val + 0.001:
            return
        raise RuntimeError("应用未确认滚动条数值改变，请重新读取应用状态。")


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        queries = [payload.get("app")] + list(payload.get("hints") or [])
        application, available = find_application(queries, payload.get("window_title"), payload.get("expected_pid"))
        if application is None:
            emit({
                "ok": False,
                "error": "系统无障碍接口中没有找到目标应用。当前应用：%s" % "、".join(filter(None, available)),
            })
            return
        window_root = find_window_root(application, payload.get("window_title"))
        command = payload.get("command") or "state"
        if command == "state":
            text, signatures = describe(window_root)
            emit({"ok": True, "text": text, "signatures": signatures})
            return
        if command == "scroll_window":
            scroll_element(window_root, payload, payload.get("background") is not False)
            emit({"ok": True})
            return
        element = element_at(
            window_root,
            payload.get("element_index"),
            expected_signature=payload.get("element_signature"),
        )
        verify_observed_content(element, payload.get("element_signature"), command)
        if command == "click":
            pointer_fallback = click_element(element, payload.get("background") is not False)
            emit({"ok": True, "pointerFallback": pointer_fallback})
            return
        elif command == "secondary":
            secondary_action(element, payload.get("action") or "", payload.get("background") is not False)
        elif command == "set_value":
            set_value(element, payload.get("value") or "")
        elif command == "select_text":
            select_text(element, payload)
        elif command == "replace_text":
            replace_text(element, payload)
        elif command == "insert_text":
            insert_text(element, payload)
        elif command == "scroll":
            scroll_element(element, payload, payload.get("background") is not False)
        elif command == "bounds":
            bounds = bounds_of(element)
            if not bounds or bounds["width"] <= 0 or bounds["height"] <= 0:
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


if __name__ == "__main__":
    main()

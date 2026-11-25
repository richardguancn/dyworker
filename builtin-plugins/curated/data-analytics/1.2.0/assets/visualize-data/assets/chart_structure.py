"""Inspect static composition structure without rendering or executing HTML."""

import json
import sys
from html.parser import HTMLParser


class ChartStructure(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.roots = []
        self.ids = []
        self.scripts = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        active = list(self.stack[-1][1]) if self.stack else []
        if "id" in attrs or "data-viz-composition" in attrs:
            root = {"id": attrs.get("id"), "elements": [], "configs": [], "options": []}
            self.roots.append(root)
            active.append(root)
        for root in active:
            root["elements"].append({"tag": tag, "attrs": attrs})
        if tag == "script":
            script = {"attrs": attrs, "source": ""}
            self.scripts.append(script)
            for root in active:
                if "data-viz-chart" in attrs:
                    root["configs"].append(script)
                if "data-viz-options" in attrs:
                    root["options"].append(script)
        if tag not in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            self.stack.append((tag, active))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        if self.stack and self.stack[-1][0] == "script":
            self.scripts[-1]["source"] += data


if __name__ == "__main__":
    try:
        parser = ChartStructure()
        parser.feed(sys.stdin.read())
        parser.close()
        print(json.dumps({"roots": parser.roots, "ids": parser.ids, "scripts": parser.scripts}))
    except ValueError as error:
        sys.exit(str(error))

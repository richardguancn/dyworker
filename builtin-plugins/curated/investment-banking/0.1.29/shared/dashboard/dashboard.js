(function () {
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function copyTextFor(block) {
    var clone = block.cloneNode(true);
    clone.querySelectorAll("[data-copy-button], .citation-popover, .table-action-bar, .dashboard-utility-bar").forEach(function (node) {
      node.remove();
    });
    clone.querySelectorAll(".citation-badge, .citation-chip, .citation-link, .source-id").forEach(function (node) {
      var label = (node.innerText || node.textContent || "").trim();
      node.replaceWith(document.createTextNode(label ? " " + label : ""));
    });
    clone.querySelectorAll("table").forEach(function (table) {
      var lines = [];
      var headers = Array.prototype.map.call(table.querySelectorAll("thead th"), function (th) {
        return th.innerText.trim();
      });
      if (headers.length) lines.push(headers.join("\t"));
      table.querySelectorAll("tbody tr").forEach(function (tr) {
        var cells = Array.prototype.map.call(tr.querySelectorAll("td"), function (td) {
          return td.innerText.replace(/\s+/g, " ").trim();
        });
        if (cells.length) lines.push(cells.join("\t"));
      });
      var pre = document.createElement("pre");
      pre.textContent = lines.join("\n");
      table.replaceWith(pre);
    });
    return clone.innerText.replace(/\n{3,}/g, "\n\n").trim();
  }

  function fallbackCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    var ok = document.execCommand("copy");
    area.remove();
    return Promise.resolve(ok);
  }

  function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return fallbackCopy(text);
  }

  function fullReportText() {
    var root = document.querySelector("[data-report-copy-root]") || document.querySelector("main");
    if (!root) return "";
    var clone = root.cloneNode(true);
    clone.querySelectorAll(".toc-list, #sources, [data-report-copy-exclude]").forEach(function (node) {
      node.remove();
    });
    return copyTextFor(clone);
  }

  function tableForButton(button) {
    var target = button.getAttribute("data-table-target");
    if (target) {
      var found = document.getElementById(target);
      if (found) return found;
    }
    var shell = button.closest("[data-table-export-wrapper]");
    return shell ? shell.querySelector("table[data-table-export]") : null;
  }

  function cleanCellText(cell) {
    var clone = cell.cloneNode(true);
    clone.querySelectorAll(".citation-popover").forEach(function (node) {
      node.remove();
    });
    clone.querySelectorAll(".citation-badge, .citation-chip, .citation-link, .source-id").forEach(function (node) {
      var label = (node.innerText || node.textContent || "").trim();
      node.replaceWith(document.createTextNode(label ? " " + label : ""));
    });
    return clone.innerText.replace(/\s+/g, " ").trim();
  }

  function tableToMatrix(table) {
    var rows = [];
    var headers = Array.prototype.map.call(table.querySelectorAll("thead th"), cleanCellText);
    if (headers.length) rows.push(headers);
    table.querySelectorAll("tbody tr").forEach(function (tr) {
      var cells = Array.prototype.map.call(tr.querySelectorAll("td"), cleanCellText);
      if (cells.length) rows.push(cells);
    });
    return rows;
  }

  function tableToTSV(table) {
    return tableToMatrix(table).map(function (row) {
      return row.join("\t");
    }).join("\n");
  }

  function csvEscape(value) {
    var raw = String(value == null ? "" : value);
    if (/[",\n\r]/.test(raw)) {
      return '"' + raw.replace(/"/g, '""') + '"';
    }
    return raw;
  }

  function tableToCSV(table) {
    return tableToMatrix(table).map(function (row) {
      return row.map(csvEscape).join(",");
    }).join("\n");
  }

  function safeFilename(value, fallback) {
    var raw = String(value || fallback || "dashboard-table.csv")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^-+|-+$/g, "");
    if (!raw) raw = fallback || "dashboard-table.csv";
    if (!/\.csv$/i.test(raw)) raw += ".csv";
    return raw;
  }

  function downloadBlob(filename, content, type) {
    var blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 250);
  }

  function markCopied(button) {
    var original = button.getAttribute("data-label-original") || button.textContent;
    button.setAttribute("data-label-original", original);
    button.classList.add("is-copied");
    var textNode = Array.prototype.find.call(button.childNodes, function (node) {
      return node.nodeType === Node.TEXT_NODE;
    });
    if (!textNode) {
      textNode = document.createTextNode("");
      button.appendChild(textNode);
    }
    textNode.nodeValue = "Copied";
    window.setTimeout(function () {
      button.classList.remove("is-copied");
      textNode.nodeValue = original.trim() || "Copy";
    }, 1300);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  var citationPopover;
  var citationHideTimer;
  var sourceData = window.DASHBOARD_SOURCE_DATA || {};
  var CITATION_SELECTOR = ".citation-chip[data-citation-id], .citation-chip[data-citation-title], .citation-badge[data-citation-id], .citation-badge[data-citation-title], .citation-link[data-citation-id], .citation-link[data-citation-title]";

  function citationField(label, value) {
    if (!value) return "";
    return '<div class="citation-popover-label">' + escapeHtml(label) + '</div><div class="citation-popover-value">' + escapeHtml(value) + '</div>';
  }

  function ensureCitationPopover() {
    if (citationPopover) return citationPopover;
    citationPopover = document.createElement("div");
    citationPopover.className = "citation-popover";
    citationPopover.id = "citation-popover";
    citationPopover.setAttribute("role", "tooltip");
    document.body.appendChild(citationPopover);
    return citationPopover;
  }

  function positionCitationPopover(popover, chip) {
    var rect = chip.getBoundingClientRect();
    var popRect = popover.getBoundingClientRect();
    var margin = 12;
    var left = rect.left + rect.width / 2 - popRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
    var top = rect.top - popRect.height - 10;
    if (top < margin) top = rect.bottom + 10;
    popover.style.left = left + "px";
    popover.style.top = top + "px";
  }

  function sourceForChip(chip) {
    var id = chip && chip.getAttribute("data-citation-id");
    if (id && sourceData[id]) return sourceData[id];
    if (chip && chip.getAttribute("data-citation-needed")) {
      return {
        id: "Needs source",
        title: "Citation needed",
        status: "Missing inline source id",
        notes: chip.getAttribute("data-tooltip") || "Attach citation_ids to this claim, number, table row, or module."
      };
    }
    if (chip && chip.getAttribute("data-citation-missing")) {
      return {
        id: "Missing source",
        title: "Source id not found",
        status: "Missing source record",
        notes: chip.getAttribute("data-tooltip") || "Add this id to the source register."
      };
    }
    if (chip && chip.getAttribute("data-citation-external")) {
      return {
        id: "External source",
        title: chip.getAttribute("data-citation-title") || "External source",
        type: "External URL",
        date: chip.getAttribute("data-citation-date") || "",
        detail: chip.getAttribute("data-citation-detail") || "",
        notes: chip.getAttribute("href") || chip.getAttribute("data-tooltip") || ""
      };
    }
    var title = chip && chip.getAttribute("data-citation-title");
    if (title) {
      return {
        id: id || "source",
        title: title,
        type: "External source",
        date: chip.getAttribute("data-citation-date") || "",
        detail: chip.getAttribute("data-citation-detail") || "",
        notes: chip.getAttribute("href") || ""
      };
    }
    return null;
  }

  function showCitationPopover(chip) {
    var source = sourceForChip(chip);
    if (!source) return;
    window.clearTimeout(citationHideTimer);
    var id = source.id || chip.getAttribute("data-citation-id") || "Source";
    var title = source.title || "Source";
    var popover = ensureCitationPopover();
    popover.innerHTML =
      '<div class="citation-popover-title"><span class="citation-popover-id">' + escapeHtml(id) + '</span>' + escapeHtml(title) + '</div>' +
      '<div class="citation-popover-grid">' +
        citationField("Type", source.type) +
        citationField("Quality", source.quality || source.status) +
        citationField("Date", source.date) +
        citationField("Workbook", source.workbook) +
        citationField("Sheet", source.sheet) +
        citationField("Range", source.range || source.workbook_ref) +
        citationField("Value", source.value) +
        citationField("Formula", source.formula) +
        citationField("Detail", source.detail) +
        citationField("URL", source.url) +
      '</div>' +
      (source.notes ? '<div class="citation-popover-note">' + escapeHtml(source.notes) + '</div>' : '<div class="citation-popover-note">' + (source.workbook_ref ? 'Click to open the workbook. If the viewer does not jump automatically, use the sheet/range shown here.' : 'Click the citation to jump to the full source row.') + '</div>');
    chip.setAttribute("aria-describedby", "citation-popover");
    popover.classList.add("show");
    positionCitationPopover(popover, chip);
  }

  function hideCitationPopover() {
    window.clearTimeout(citationHideTimer);
    citationHideTimer = window.setTimeout(function () {
      document.querySelectorAll("[aria-describedby='citation-popover']").forEach(function (node) {
        node.removeAttribute("aria-describedby");
      });
      if (citationPopover) citationPopover.classList.remove("show");
    }, 120);
  }

  ready(function () {
    var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc-link"));
    var sections = tocLinks
      .map(function (link) { return document.querySelector(link.getAttribute("href")); })
      .filter(Boolean);

    function setActive(id) {
      tocLinks.forEach(function (link) {
        link.classList.toggle("is-active", link.getAttribute("href") === "#" + id);
      });
    }

    if ("IntersectionObserver" in window && sections.length) {
      var observer = new IntersectionObserver(function (entries) {
        var visible = entries
          .filter(function (entry) { return entry.isIntersecting; })
          .sort(function (a, b) { return b.intersectionRatio - a.intersectionRatio; })[0];
        if (visible && visible.target) setActive(visible.target.id);
      }, { rootMargin: "-18% 0px -70% 0px", threshold: [0.1, 0.35, 0.6] });
      sections.forEach(function (section) { observer.observe(section); });
    }

    tocLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        setActive((link.getAttribute("href") || "").replace("#", ""));
      });
    });

    document.addEventListener("click", function (event) {
      var tsvButton = event.target.closest("[data-copy-table-tsv]");
      if (tsvButton) {
        var tsvTable = tableForButton(tsvButton);
        if (!tsvTable) return;
        var tsv = tableToTSV(tsvTable);
        if (!tsv) return;
        writeClipboard(tsv).then(function () {
          markCopied(tsvButton);
        }).catch(function () {
          tsvButton.classList.add("copy-failed");
        });
        return;
      }

      var csvButton = event.target.closest("[data-download-table-csv]");
      if (csvButton) {
        var csvTable = tableForButton(csvButton);
        if (!csvTable) return;
        var csv = tableToCSV(csvTable);
        if (!csv) return;
        downloadBlob(safeFilename(csvTable.getAttribute("data-download-filename"), "dashboard-table.csv"), csv, "text/csv;charset=utf-8");
        markCopied(csvButton);
        return;
      }

      var fullReportButton = event.target.closest("[data-copy-full-report]");
      if (fullReportButton) {
        var reportText = fullReportText();
        if (!reportText) return;
        writeClipboard(reportText).then(function () {
          markCopied(fullReportButton);
        }).catch(function () {
          fullReportButton.classList.add("copy-failed");
        });
        return;
      }

      var printButton = event.target.closest("[data-print-dashboard]");
      if (printButton) {
        window.print();
        return;
      }

      var button = event.target.closest("[data-copy-button]");
      if (!button) return;
      var block = button.closest("[data-copy-block]");
      if (!block) return;
      var text = copyTextFor(block);
      if (!text) return;
      writeClipboard(text).then(function () {
        markCopied(button);
      }).catch(function () {
        button.classList.add("copy-failed");
      });
    });

    document.addEventListener("mouseover", function (event) {
      var chip = event.target.closest(CITATION_SELECTOR);
      if (chip) showCitationPopover(chip);
    });

    document.addEventListener("focusin", function (event) {
      var chip = event.target.closest(CITATION_SELECTOR);
      if (chip) showCitationPopover(chip);
    });

    document.addEventListener("mouseout", function (event) {
      if (event.target.closest(CITATION_SELECTOR)) hideCitationPopover();
    });

    document.addEventListener("focusout", function (event) {
      if (event.target.closest(CITATION_SELECTOR)) hideCitationPopover();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        hideCitationPopover();
        if (document.activeElement && document.activeElement.matches && document.activeElement.matches(CITATION_SELECTOR)) {
          document.activeElement.blur();
        }
      }
    });

    if (window.location.hash) {
      var target = document.querySelector(window.location.hash);
      if (target) window.setTimeout(function () { target.scrollIntoView(); }, 50);
    }

    if ("ResizeObserver" in window) {
      var ro = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          entry.target.dispatchEvent(new CustomEvent("dashboard:resize", { bubbles: false }));
        });
      });
      document.querySelectorAll("[data-responsive-chart]").forEach(function (el) { ro.observe(el); });
    }
  });
})();

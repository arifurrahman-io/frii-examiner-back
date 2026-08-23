const DEFAULT_ROW_HEIGHT = 26;
const DEFAULT_CELL_PADDING = 3;
const DEFAULT_MAX_LINES = 2;
const DEFAULT_FONT_SIZE = 8;

const fitAutoTableCellText = (
  doc,
  text,
  columnWidth,
  {
    fontSize = DEFAULT_FONT_SIZE,
    cellPadding = DEFAULT_CELL_PADDING,
    maxLines = DEFAULT_MAX_LINES,
    fontStyle = "normal",
  } = {}
) => {
  const value = String(text ?? "");
  if (!value) return [""];

  doc.setFont("helvetica", fontStyle);
  doc.setFontSize(fontSize);
  const usableWidth = Math.max(columnWidth - cellPadding * 2, 16);
  const lines = doc.splitTextToSize(value, usableWidth);
  return lines.slice(0, maxLines);
};

const resolveColumnWidth = (data, columnWidths = {}) => {
  if (columnWidths[data.column.index] != null) {
    return columnWidths[data.column.index];
  }

  const styledWidth = data.cell.styles?.cellWidth;
  if (styledWidth && styledWidth !== "auto" && styledWidth !== "wrap") {
    return styledWidth;
  }

  if (data.cell.width) {
    return data.cell.width - data.cell.padding("horizontal");
  }

  const tableWidth = data.table?.width || data.settings?.tableWidth;
  const columnCount = data.table?.columns?.length || data.table?.body?.[0]?.length;
  if (tableWidth && columnCount) {
    return tableWidth / columnCount;
  }

  return 48;
};

const getUniformTableStyles = (overrides = {}) => ({
  overflow: "hidden",
  valign: "middle",
  cellPadding: DEFAULT_CELL_PADDING,
  fontSize: DEFAULT_FONT_SIZE,
  ...overrides,
});

const getUniformBodyStyles = (rowHeight = DEFAULT_ROW_HEIGHT) => ({
  minCellHeight: rowHeight,
  valign: "middle",
  overflow: "hidden",
});

const withUniformHeadStyles = (headStyles = {}, rowHeight = DEFAULT_ROW_HEIGHT) => ({
  ...headStyles,
  minCellHeight: rowHeight,
  valign: "middle",
  overflow: "hidden",
});

const createUniformRowDidParseCell = (
  doc,
  {
    rowHeight = DEFAULT_ROW_HEIGHT,
    fontSize = DEFAULT_FONT_SIZE,
    cellPadding = DEFAULT_CELL_PADDING,
    maxLines = DEFAULT_MAX_LINES,
    columnMaxLines = {},
    columnWidths = {},
    beforeParse = null,
    afterParse = null,
    fitHead = false,
  } = {}
) => {
  return (data) => {
    data.cell.styles.minCellHeight = rowHeight;
    data.cell.styles.valign = "middle";
    data.cell.styles.overflow = "hidden";

    if (beforeParse) beforeParse(data);

    const shouldFitText =
      data.section === "body" || (fitHead && data.section === "head");

    if (shouldFitText) {
      const span = data.cell.rowSpan || 1;
      const width = resolveColumnWidth(data, columnWidths);
      const cellFontSize = data.cell.styles.fontSize || fontSize;
      const padding =
        typeof data.cell.styles.cellPadding === "number"
          ? data.cell.styles.cellPadding
          : cellPadding;
      const lineLimit =
        columnMaxLines[data.column.index] ?? maxLines;

      const rawText = data.cell.raw && typeof data.cell.raw === "object" && data.cell.raw.content !== undefined
        ? data.cell.raw.content
        : data.cell.raw;

      data.cell.text = fitAutoTableCellText(doc, rawText, width, {
        fontSize: cellFontSize,
        cellPadding: padding,
        maxLines: lineLimit * span,
        fontStyle: data.cell.styles.fontStyle === "bold" ? "bold" : "normal",
      });
    }

    if (afterParse) afterParse(data);
  };
};

module.exports = {
  DEFAULT_ROW_HEIGHT,
  DEFAULT_CELL_PADDING,
  DEFAULT_MAX_LINES,
  DEFAULT_FONT_SIZE,
  fitAutoTableCellText,
  resolveColumnWidth,
  getUniformTableStyles,
  getUniformBodyStyles,
  withUniformHeadStyles,
  createUniformRowDidParseCell,
};

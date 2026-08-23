const fs = require("fs");
const path = require("path");

const INSTITUTE_NAME = "Faizur Rahman Ideal Institute";

const BRAND = {
  navy: [15, 23, 42],
  slate: [51, 65, 85],
  muted: [100, 116, 139],
  teal: [15, 118, 110],
  line: [203, 213, 225],
};

const INSTITUTE_LOGO_PATH = path.join(__dirname, "..", "assets", "frii-logo.png");

let cachedLogoDataUrl = null;

const getInstituteLogoDataUrl = () => {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  if (!fs.existsSync(INSTITUTE_LOGO_PATH)) return null;
  const buffer = fs.readFileSync(INSTITUTE_LOGO_PATH);
  cachedLogoDataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
  return cachedLogoDataUrl;
};

const drawInstituteLogo = (doc, options = {}) => {
  const { x = 36, y = 24, width = 46, height = 58 } = options;
  const logo = getInstituteLogoDataUrl();
  if (!logo) return false;
  doc.addImage(logo, "PNG", x, y, width, height);
  return true;
};

const getInstituteDividerY = (baselineY) => baselineY + 5;

const getTitleBaselineY = (dividerY, titleFontSize = 13) =>
  dividerY + 4 + titleFontSize * 0.78;

const drawInstituteHeader = (doc, options = {}) => {
  const {
    y = 24,
    fontSize = 17,
    align = "center",
    color = BRAND.navy,
    x = null,
    withDivider = false,
    dividerWidth = null,
  } = options;
  const pageWidth = doc.internal.pageSize.getWidth();
  const xPos = x ?? (align === "center" ? pageWidth / 2 : x ?? 40);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(fontSize);
  doc.setTextColor(...color);
  doc.text(INSTITUTE_NAME, xPos, y, { align });

  const dividerY = getInstituteDividerY(y);

  if (withDivider) {
    const width = dividerWidth ?? Math.min(pageWidth * 0.62, 420);
    const halfWidth = width / 2;
    const centerX = align === "center" ? pageWidth / 2 : xPos;
    doc.setDrawColor(...BRAND.teal);
    doc.setLineWidth(0.9);
    doc.line(centerX - halfWidth, dividerY, centerX + halfWidth, dividerY);
  }

  return withDivider ? dividerY : y + 4;
};

const drawReportTitleBlock = (doc, options = {}) => {
  const {
    y,
    title = null,
    subtitle = null,
    subtitleLines = null,
    titleFontSize = 13,
    subtitleFontSize = 10.5,
    centerX = doc.internal.pageSize.getWidth() / 2,
  } = options;

  let currentY = y;

  if (title) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(titleFontSize);
    doc.setTextColor(...BRAND.navy);
    doc.text(title, centerX, currentY, { align: "center" });
    currentY += titleFontSize + 6;
  }

  const lines =
    subtitleLines ?? (subtitle ? doc.splitTextToSize(String(subtitle), 480) : []);

  if (lines.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(subtitleFontSize);
    doc.setTextColor(...BRAND.slate);
    lines.forEach((line) => {
      doc.text(line, centerX, currentY, { align: "center" });
      currentY += subtitleFontSize + 4;
    });
  }

  return currentY - 4;
};

const drawProfessionalReportHeader = (doc, options = {}) => {
  const {
    y = 24,
    instituteFontSize = 17,
    withDivider = true,
    title = null,
    subtitle = null,
    subtitleLines = null,
    titleFontSize = 13,
    subtitleFontSize = 10.5,
    centerX = doc.internal.pageSize.getWidth() / 2,
  } = options;

  drawInstituteHeader(doc, {
    y,
    fontSize: instituteFontSize,
    withDivider,
    x: centerX,
    align: "center",
  });

  const titleStartY = title
    ? getTitleBaselineY(getInstituteDividerY(y), titleFontSize)
    : getInstituteDividerY(y) + 8;

  return drawReportTitleBlock(doc, {
    y: titleStartY,
    title,
    subtitle,
    subtitleLines,
    titleFontSize,
    subtitleFontSize,
    centerX,
  });
};

module.exports = {
  INSTITUTE_NAME,
  BRAND,
  INSTITUTE_LOGO_PATH,
  getInstituteLogoDataUrl,
  drawInstituteLogo,
  drawInstituteHeader,
  drawReportTitleBlock,
  drawProfessionalReportHeader,
};

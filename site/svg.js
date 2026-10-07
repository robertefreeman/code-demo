const NS = "http://www.w3.org/2000/svg";
const ELEMENTS = new Set([
  "svg", "g", "defs", "title", "desc", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "path", "text", "tspan", "linearGradient",
  "radialGradient", "stop", "clipPath", "mask", "pattern",
]);
const ATTRIBUTES = new Set([
  "id", "viewBox", "width", "height", "preserveAspectRatio", "x", "y",
  "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "stroke-dasharray", "stroke-dashoffset", "opacity", "transform",
  "gradientTransform", "gradientUnits", "spreadMethod", "offset",
  "stop-color", "stop-opacity", "fx", "fy", "fr", "clip-path", "clip-rule",
  "clipPathUnits", "mask", "maskUnits", "maskContentUnits", "patternUnits",
  "patternContentUnits", "patternTransform", "font-family", "font-size",
  "font-weight", "font-style", "text-anchor", "dominant-baseline",
  "alignment-baseline", "letter-spacing", "dx", "dy", "rotate",
]);

// Rebuild a small, static SVG vocabulary rather than inserting model output as HTML.
export function sanitizeSvg(source) {
  if (typeof source !== "string" || source.length > 100_000 || /<!DOCTYPE|<!ENTITY|<\?/i.test(source)) {
    throw new Error("The AI returned unsupported SVG. Try a simpler prompt.");
  }
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.getElementsByTagName("parsererror").length || parsed.documentElement.localName !== "svg") {
    throw new Error("The AI returned invalid SVG. Try generating again.");
  }
  const clean = document.implementation.createDocument(NS, "svg", null);
  let count = 0;
  function copy(element, depth = 0) {
    if (++count > 2500 || depth > 40 || element.namespaceURI !== NS || !ELEMENTS.has(element.localName)) {
      throw new Error("The AI returned unsupported SVG elements. Try a simpler prompt.");
    }
    const node = clean.createElementNS(NS, element.localName);
    for (const attribute of element.attributes) {
      if (attribute.name === "xmlns" && attribute.value === NS) continue;
      if (attribute.namespaceURI || !ATTRIBUTES.has(attribute.name)) {
        throw new Error("The AI returned unsupported SVG attributes. Try generating again.");
      }
      const value = attribute.value;
      // Only local paint/clip/mask references are allowed; CSS escapes are not.
      if (/[\\<>]/.test(value) || /url\s*\(/i.test(value) && !/^url\(#[A-Za-z_][\w.-]*\)$/.test(value)) {
        throw new Error("The AI returned unsafe SVG references. Try generating again.");
      }
      node.setAttribute(attribute.name, value);
    }
    for (const child of element.childNodes) {
      if (child.nodeType === 1) node.append(copy(child, depth + 1));
      else if (child.nodeType === 3 || child.nodeType === 4) node.append(clean.createTextNode(child.textContent));
    }
    return node;
  }
  const root = copy(parsed.documentElement);
  const box = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!box || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) {
    throw new Error("The AI returned SVG without a valid viewBox. Try generating again.");
  }
  root.setAttribute("xmlns", NS);
  clean.replaceChild(root, clean.documentElement);
  return new XMLSerializer().serializeToString(clean);
}

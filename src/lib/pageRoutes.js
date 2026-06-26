// Auto-discovered, code-split page routes.
//
// The auto-generated pages.config.js statically imports every page, which
// bundled all ~40 pages into one ~2.4 MB chunk that downloaded on first load.
// Nothing imports pages.config anymore — instead we discover pages with Vite's
// import.meta.glob (lazy by default), so each page becomes its own chunk loaded
// on demand. New page files are picked up automatically, matching the platform's
// "drop a file in /pages" convention.
//
// Pages handled OUTSIDE the auth gate (their own routes in App.jsx) are excluded
// here so they don't also get an authenticated route.
const modules = import.meta.glob('../pages/*.jsx');

const EXCLUDE = new Set(['Login', 'ServiceRequestPublic']);
const nameOf = (filePath) => filePath.slice(filePath.lastIndexOf('/') + 1, -'.jsx'.length);

export const pageLoaders = {};
for (const [filePath, loader] of Object.entries(modules)) {
  const name = nameOf(filePath);
  if (!EXCLUDE.has(name)) pageLoaders[name] = loader;
}

// "לידים" was merged into "ניהול לידים"; keep /Leads as an alias to
// LeadManagement so existing deep-links still resolve (matches pages.config).
if (pageLoaders.LeadManagement) {
  pageLoaders.Leads = pageLoaders.LeadManagement;
}

export const pageNames = Object.keys(pageLoaders);

// Landing page (was pagesConfig.mainPage).
export const mainPage = 'Dashboard2';

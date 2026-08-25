import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  }));
  return files.flat();
};

const normalize = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const phoneDigits = (value) => String(value ?? '').replace(/\D/g, '');
const pageFile = (page) => normalize(page) === 'home'
  ? 'index.html'
  : `${normalize(page).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.html`;

export async function validateGeneratedSite(siteDirectory = 'generated-sites/AF-2026-000001') {
const projectDirectory = path.resolve(siteDirectory);
const projectRoot = `${projectDirectory}${path.sep}`;
const read = async (name) => readFile(path.join(projectDirectory, name), 'utf8');
const exists = async (absolutePath) => access(absolutePath).then(() => true, () => false);
const relativeName = (absolutePath) => path.relative(projectDirectory, absolutePath).split(path.sep).join('/');
const checks = [];
const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail });

const [specSource, configSource, allFiles] = await Promise.all([
  read('project_spec.json'),
  read('business.config.json'),
  walk(projectDirectory),
]);
const spec = JSON.parse(specSource);
const config = JSON.parse(configSource);
const htmlFiles = allFiles.filter((file) => path.extname(file).toLowerCase() === '.html');
const jsFiles = allFiles.filter((file) => path.extname(file).toLowerCase() === '.js');
const htmlEntries = await Promise.all(htmlFiles.map(async (file) => [file, await readFile(file, 'utf8')]));
const customerHtml = htmlEntries.map(([, source]) => source).join('\n');

check('Canonical project ID', /^AF-\d{4}-\d{6}$/.test(spec.projectId), spec.projectId);
check(
  'Project/config ID match',
  spec.projectId === config.meta?.projectId,
  `${spec.projectId ?? 'missing'} / ${config.meta?.projectId ?? 'missing'}`,
);
check(
  'Business name identity',
  normalize(spec.business?.name) !== '' && normalize(spec.business?.name) === normalize(config.business?.name),
  `${spec.business?.name ?? 'missing'} / ${config.business?.name ?? 'missing'}`,
);
check(
  'Business address identity',
  normalize(spec.business?.location) !== '' && normalize(spec.business?.location) === normalize(config.business?.address),
  `${spec.business?.location ?? 'missing'} / ${config.business?.address ?? 'missing'}`,
);

const specPhone = phoneDigits(spec.business?.phone);
const displayPhone = phoneDigits(config.business?.phoneDisplay);
const linkedPhone = phoneDigits(config.business?.phoneLink);
const whatsappPhone = phoneDigits(String(config.business?.whatsappLink ?? '').split('?')[0]);
check(
  'Business phone identity',
  specPhone !== '' && specPhone === displayPhone && specPhone === linkedPhone
    && (!config.features?.whatsappOrdering || whatsappPhone.endsWith(specPhone)),
  `${spec.business?.phone ?? 'missing'} / ${config.business?.phoneDisplay ?? 'missing'}`,
);

const quotedPrice = Number(spec.commercial?.quotedPrice);
const finalPrice = Number(spec.commercial?.finalPrice);
check(
  'Approved commercial terms',
  Number.isFinite(quotedPrice) && Number.isFinite(finalPrice) && finalPrice > 0
    && quotedPrice >= finalPrice && /^[A-Z]{3}$/.test(spec.commercial?.currency ?? ''),
  `${spec.commercial?.currency ?? 'currency missing'} ${finalPrice || 'price missing'}`,
);

const declaredPages = Array.isArray(spec.pages) ? spec.pages : [];
const declaredPageFiles = declaredPages.map(pageFile);
const actualHtmlFiles = htmlFiles.map(relativeName).sort();
check(
  'Declared pages have files',
  declaredPages.length > 0 && declaredPageFiles.every((file) => actualHtmlFiles.includes(file)),
  declaredPageFiles.join(', ') || 'No pages declared',
);
check(
  'HTML files are declared pages',
  actualHtmlFiles.every((file) => declaredPageFiles.includes(file)),
  actualHtmlFiles.join(', ') || 'No HTML files found',
);

const specFeatures = spec.features && typeof spec.features === 'object' ? spec.features : {};
const configFeatures = config.features && typeof config.features === 'object' ? config.features : {};
const featureNames = [...new Set([...Object.keys(specFeatures), ...Object.keys(configFeatures)])].sort();
const featureMismatches = featureNames.filter((feature) => (
  typeof specFeatures[feature] !== 'boolean'
  || typeof configFeatures[feature] !== 'boolean'
  || specFeatures[feature] !== configFeatures[feature]
));
check(
  'Spec/config feature scope matches',
  featureNames.length > 0 && featureMismatches.length === 0,
  featureMismatches.length ? `Mismatched: ${featureMismatches.join(', ')}` : featureNames.join(', '),
);

const hasMenuSurface = actualHtmlFiles.includes('menu.html') && /data-menu-grid/i.test(customerHtml);
const hasGallerySurface = actualHtmlFiles.includes('gallery.html') && /data-gallery-grid/i.test(customerHtml);
const hasWhatsAppSurface = /(?:wa\.me|whatsapp\.com|\bwhatsapp\b)/i.test(customerHtml);
const hasMapsSurface = /id=["'](?:mapsLink|contactMaps|mapFrame)["']/i.test(customerHtml);
const hasReservationSurface = /(?:id|data-[\w-]*)=["'][^"']*reserv|reserve a table|book a table/i.test(customerHtml);

const featureCheck = (feature, evidence, description) => {
  const purchased = specFeatures[feature] === true;
  check(
    `Feature scope: ${feature}`,
    typeof specFeatures[feature] === 'boolean' && (purchased ? evidence : !evidence),
    `${purchased ? 'Purchased' : 'Omitted'}; ${description}`,
  );
};

featureCheck('menu', hasMenuSurface, hasMenuSurface ? 'menu page and content present' : 'menu page/content absent');
featureCheck('gallery', hasGallerySurface, hasGallerySurface ? 'gallery page and content present' : 'gallery page/content absent');
featureCheck('whatsappOrdering', hasWhatsAppSurface, hasWhatsAppSurface ? 'WhatsApp actions present' : 'WhatsApp actions absent');
featureCheck('googleMaps', hasMapsSurface, hasMapsSurface ? 'map actions present' : 'map actions absent');
featureCheck('reservations', hasReservationSurface, hasReservationSurface ? 'reservation UI present' : 'reservation UI absent');

const configUrls = [];
const collectConfigUrls = (value, trail = []) => {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const itemTrail = [...trail, key];
    if (typeof item === 'string' && /(?:href|src|link|embed)$/i.test(key)) {
      configUrls.push({ key, path: itemTrail.join('.'), value: item.trim() });
    } else if (item && typeof item === 'object') {
      collectConfigUrls(item, itemTrail);
    }
  }
};
collectConfigUrls(config);

const configuredUrlErrors = [];
for (const item of configUrls) {
  if (!item.value) continue;
  let allowedProtocols = new Set(['http:', 'https:', 'tel:', 'mailto:']);
  if (/embed$|src$/i.test(item.key) || /whatsapp|maps/i.test(item.key)) {
    allowedProtocols = new Set(['http:', 'https:']);
  } else if (/phone/i.test(item.key)) {
    allowedProtocols = new Set(['tel:']);
  }

  try {
    const parsed = new URL(item.value, 'https://agentfront.invalid/');
    if (!allowedProtocols.has(parsed.protocol)) configuredUrlErrors.push(`${item.path} (${parsed.protocol})`);
  } catch {
    configuredUrlErrors.push(`${item.path} (invalid URL)`);
  }
}
check(
  'Configured URLs use safe protocols',
  configuredUrlErrors.length === 0,
  configuredUrlErrors.length ? configuredUrlErrors.join(', ') : `${configUrls.length} URL fields checked`,
);

const whatsappConfigured = (() => {
  try {
    const parsed = new URL(config.business?.whatsappLink ?? '');
    return ['http:', 'https:'].includes(parsed.protocol)
      && /(?:(?:^|\.)wa\.me|(?:^|\.)whatsapp\.com)$/i.test(parsed.hostname);
  } catch {
    return false;
  }
})();
check(
  'WhatsApp feature configuration',
  specFeatures.whatsappOrdering === true
    ? whatsappConfigured
    : !String(config.business?.whatsappLink ?? '').trim(),
  specFeatures.whatsappOrdering === true ? 'Valid WhatsApp destination configured' : 'No destination configured',
);

const mapsConfigured = ['mapsLink', 'mapsEmbed'].every((key) => {
  const raw = config.business?.[key];
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const destination = parsed.searchParams.get('query') ?? parsed.searchParams.get('q') ?? '';
    return ['http:', 'https:'].includes(parsed.protocol)
      && /(?:^|\.)google\.[a-z.]+$/i.test(parsed.hostname)
      && normalize(destination) === normalize(config.business?.address);
  } catch {
    return false;
  }
});
check(
  'Maps feature configuration',
  specFeatures.googleMaps === true
    ? mapsConfigured
    : !String(config.business?.mapsLink ?? '').trim() && !String(config.business?.mapsEmbed ?? '').trim(),
  specFeatures.googleMaps === true ? 'Links target the configured address' : 'No map destinations configured',
);

const htmlReferenceErrors = [];
let htmlReferenceCount = 0;
for (const [htmlFile, source] of htmlEntries) {
  const references = [...source.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)].map((match) => match[1].trim());
  for (const reference of references) {
    if (!reference || reference.startsWith('#')) continue;
    htmlReferenceCount += 1;
    const scheme = reference.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    if (scheme) {
      if (!['http', 'https', 'tel', 'mailto'].includes(scheme)) {
        htmlReferenceErrors.push(`${relativeName(htmlFile)}: unsafe ${scheme}: reference`);
      }
      continue;
    }
    if (reference.startsWith('//')) {
      htmlReferenceErrors.push(`${relativeName(htmlFile)}: protocol-relative reference`);
      continue;
    }

    let cleanReference;
    try {
      cleanReference = decodeURIComponent(reference.split(/[?#]/)[0]);
    } catch {
      htmlReferenceErrors.push(`${relativeName(htmlFile)}: malformed reference`);
      continue;
    }
    if (!cleanReference) continue;
    const target = path.resolve(path.dirname(htmlFile), cleanReference);
    if (!(target === projectDirectory || target.startsWith(projectRoot)) || !(await exists(target))) {
      htmlReferenceErrors.push(`${relativeName(htmlFile)}: ${reference}`);
    }
  }
}
check(
  'All HTML references resolve safely',
  htmlReferenceErrors.length === 0,
  htmlReferenceErrors.length ? htmlReferenceErrors.join(', ') : `${htmlReferenceCount} references checked across ${htmlFiles.length} pages`,
);

const jsSyntaxErrors = [];
for (const jsFile of jsFiles) {
  try {
    new Script(await readFile(jsFile, 'utf8'), { filename: relativeName(jsFile) });
  } catch (error) {
    jsSyntaxErrors.push(`${relativeName(jsFile)}: ${error.message}`);
  }
}
check(
  'JavaScript parses',
  jsFiles.length > 0 && jsSyntaxErrors.length === 0,
  jsSyntaxErrors.length ? jsSyntaxErrors.join(', ') : `${jsFiles.length} script file${jsFiles.length === 1 ? '' : 's'} checked`,
);

const responsivePages = htmlEntries.filter(([, source]) => /<meta\b[^>]*name=["']viewport["']/i.test(source));
check('Responsive viewport on every page', responsivePages.length === htmlFiles.length, `${responsivePages.length}/${htmlFiles.length} pages`);

const landmarkPages = htmlEntries.filter(([, source]) => (
  /<main[\s>]/i.test(source) && /<nav[\s>]/i.test(source) && /<footer[\s>]/i.test(source)
));
check('Accessible landmarks on every page', landmarkPages.length === htmlFiles.length, `${landmarkPages.length}/${htmlFiles.length} pages`);

const imagesMissingAlt = htmlEntries.flatMap(([file, source]) => (
  [...source.matchAll(/<img\b(?![^>]*\balt\s*=)[^>]*>/gi)].map(() => relativeName(file))
));
check('Images have alternative text', imagesMissingAlt.length === 0, imagesMissingAlt.length ? imagesMissingAlt.join(', ') : 'All img elements include alt');

const previewPages = htmlEntries.filter(([, source]) => /data-preview/i.test(source) && /\bdemo\b|\bpreview\b/i.test(source));
check(
  'Demo state is labelled on every page',
  config.meta?.preview === true && previewPages.length === htmlFiles.length && /\bdemo\b|\bpreview\b/i.test(config.meta?.previewLabel ?? ''),
  `${previewPages.length}/${htmlFiles.length} pages labelled`,
);

const placeholderPattern = /(?:lorem ipsum|todo:|replace me|your business name|your (?:phone|address)|phone here|address here|example\.com|xxxxx|tbd)/i;
const contactCorpus = [
  spec.business?.name,
  spec.business?.location,
  spec.business?.phone,
  config.business?.name,
  config.business?.address,
  config.business?.phoneDisplay,
].join('\n');
const obviousFakePhone = !/^\d{10,15}$/.test(specPhone)
  || /^(?:0+|1+|9+|1234567890|9876543210)$/.test(specPhone)
  || /^(\d)\1{9,}$/.test(specPhone);
check(
  'Contact details are intentional',
  !placeholderPattern.test(contactCorpus) && !obviousFakePhone,
  obviousFakePhone || placeholderPattern.test(contactCorpus) ? 'Placeholder or obviously fake contact found' : 'Name, address and phone validated',
);

const siteCorpus = `${customerHtml}\n${configSource}`;
check('No placeholder copy', !placeholderPattern.test(siteCorpus), 'Common placeholder patterns checked');

const passed = checks.filter((item) => item.passed).length;
const score = Math.round((passed / checks.length) * 100);
const report = { projectId: spec.projectId, score, passed, total: checks.length, checks };

return report;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const report = await validateGeneratedSite(process.argv[2]);
  console.log(JSON.stringify(report, null, 2));
  if (report.checks.some((item) => !item.passed)) process.exitCode = 1;
}

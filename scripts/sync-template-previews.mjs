import { access, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(repositoryRoot, 'templates');
const targetRoot = resolve(repositoryRoot, 'apps/web/public/templates');
const demoSiteSource = resolve(repositoryRoot, 'generated-sites/AF-2026-000001');
const demoSiteTarget = resolve(repositoryRoot, 'apps/web/public/generated-sites/AF-2026-000001');
const templateSlugs = ['restaurant', 'salon', 'garments', 'mechanic', 'clinic', 'education', 'realestate', 'fitness', 'bakery', 'legal', 'spa', 'dental', 'physiotherapy', 'petcare', 'catering', 'events', 'photography', 'interiors', 'travel', 'movers', 'appliance', 'trades', 'detailing', 'drivingschool', 'laundry', 'furniture', 'devicerepair', 'printing', 'florist', 'jewellery', 'tailoring', 'cloudkitchen'];

for (const slug of templateSlugs) {
  await access(resolve(sourceRoot, slug, 'index.html'));
}

// This directory is a generated public mirror. The canonical, editable
// templates remain under /templates and are copied before dev/build.
await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });
await cp(resolve(sourceRoot, '_shared-template.css'), resolve(targetRoot, '_shared-template.css'), { force: true });
await cp(resolve(sourceRoot, '_shared-template.js'), resolve(targetRoot, '_shared-template.js'), { force: true });

for (const slug of templateSlugs) {
  await cp(resolve(sourceRoot, slug), resolve(targetRoot, slug), {
    recursive: true,
    force: true,
  });
}

// The public copy is always rebuilt from the reviewed, checked-in example.
// Runtime-generated client workspaces stay under ignored .agentfront-runtime
// and must never be copied into the dashboard bundle.
await access(resolve(demoSiteSource, 'index.html'));
await rm(demoSiteTarget, { recursive: true, force: true });
await mkdir(resolve(demoSiteTarget, '..'), { recursive: true });
await cp(demoSiteSource, demoSiteTarget, { recursive: true, force: true });

process.stdout.write(`Synced ${templateSlugs.length} template previews and the reviewed demo site for AgentFront.\n`);

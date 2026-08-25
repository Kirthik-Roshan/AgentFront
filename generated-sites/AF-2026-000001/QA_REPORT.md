# QA report — AF-2026-000001

Status: **PASSED**  
Score: **100 / 100**  
Deterministic checks: **25 / 25 passed**

The `npm run qa:site` gate verifies project/config identity, approved commercial terms, the exact declared page files, configured purchased and omitted features, safe configuration URLs, and consistent phone, address, WhatsApp, and Maps destinations. It parses every JavaScript file and checks local references, responsive metadata, landmarks, image alternatives, and demo disclosure across every HTML page.

Additional regression tests prove the gate rejects unsafe URL protocols, feature-scope drift, broken references on non-home pages, and JavaScript syntax errors.

The generated restaurant preview intentionally leaves unverified prices and opening hours unpublished, clearly labels demo business data and launch imagery, and omits the unpurchased reservation interface.

Commands used:

```text
npm run qa:site
npx vitest run scripts/validate-generated-site.test.ts
```

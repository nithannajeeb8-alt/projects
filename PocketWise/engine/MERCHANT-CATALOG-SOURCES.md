# PocketWise built-in merchant catalogue

The compiled catalogue contains **973 distinct canonical merchant names** and **2,901 matching patterns** in this release. The aliases are embedded in `merchant_catalog.inc` and compiled into `pocketwise-engine.wasm`; no network request is made during categorisation. The catalogue covers national merchants and billers, regional retailers and services, Kerala-specific merchants and utilities, and selected Jammu & Kashmir businesses and utility descriptors.

## Sources and curation method

- **Bank-statement billing descriptors:** SBI Card's published merchant-name list documents that a public brand and its billing descriptor can differ (for example DMart / Avenue Supermart, Domino's / Jubilant Food Works, Nykaa / FSN E-Commerce Ventures, Milk Basket / Reliance Retail, and Zepto / Geddit). This supports the alias-matching approach rather than relying on one exact display name: <https://www.sbicard.com/sbi-card-en/assets/docs/pdf/merchant-name-list.pdf>.
- **Kerala retailers and services:** Cedar Retail's official brand directory identifies Café Crosso, Cedar Gourmet, Cedar Supermart and related local brands; these are mapped to food, groceries or shopping according to the published business description: <https://cedarretail.in/brands/>.
- **Jammu & Kashmir merchants and local commerce:** the Srinagar District Administration lists Kashmir Government Arts Emporium locations and their handicraft specialities. The J&K Trade Promotion Organisation's ODOP material provides district-level product and seller context used to broaden local merchant coverage: <https://srinagar.nic.in/emporiums/> and <https://jktpo.jk.gov.in/pdf/odop.pdf>.
- **Biller and service categories:** Federal Bank's BBPS biller directory lists more than 130 billers, including Kerala State Electricity Board (KSEBL), regional power distributors, broadband providers, DTH and gas billers; it was used as a reference for utility, telecom and recurring-payment coverage: <https://www.federal.bank.in/bbps-billers>. The category set is aligned to PocketWise activity IDs.

The catalogue also includes common spelling/descriptor variants and widely used Indian merchant names across food delivery, groceries, transport, fuel, utilities, healthcare, education, entertainment, shopping, subscriptions, salary, freelance work, savings and refunds. Merchant-to-category assignments are heuristics based on the merchant's main consumer-facing use, not a claim that every transaction at that merchant always belongs to that category.

## Matching and user control

- Patterns are sorted by specificity before matching; longer billing descriptors are intended to win over short brand tokens.
- Matching is performed locally by the C++ WebAssembly engine.
- Learned rules and user-supplied aliases take precedence over built-in entries and remain in the user's local PocketWise data.
- Unknown merchants are not sent to a server. Users can teach a merchant and add alternate billing names under **Settings → Merchant categorisation**.
- The catalogue is curated, not exhaustive. Banks may change their billing descriptors, and a merchant may use different legal names across payment processors. Custom aliases are therefore a first-class feature.

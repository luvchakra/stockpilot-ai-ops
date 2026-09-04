# StockPilot AI

STOCKPILOT



AI-Powered Inventory, Procurement & Business Operations Platform



Version: 1.0

Status: Development Specification

Target Market: India-first, globally extensible

Primary Build Platforms: Vercel + Emergent

Primary Architecture: Multi-tenant SaaS

Recommended Backend: PostgreSQL + Supabase

Recommended Frontend: React + TypeScript + Tailwind + shadcn/ui



---



1. PRODUCT VISION



StockPilot is a cloud-based, multi-tenant inventory and business operations SaaS platform designed initially for Indian businesses.



The platform combines:



- Inventory management

- Warehouse management

- Product/SKU management

- Barcode and QR scanning

- Purchasing

- Supplier management

- Sales order management

- Omnichannel sales synchronization

- Invoicing

- Accounting integrations

- Inventory forecasting

- Stockout prediction

- Excess inventory detection

- Automated alerts

- AI-powered business intelligence

- Workflow automation

- Reporting

- Multi-user collaboration



The fundamental product philosophy is:



«Don't just tell businesses what their inventory is. Tell them what they should do next.»



---



2. CORE PRODUCT PROMISE



StockPilot should continuously answer:



1. What inventory do I have?

2. Where is it?

3. What has been sold?

4. What is coming in?

5. What is running out?

6. What is overstocked?

7. What should I purchase?

8. From whom should I purchase?

9. When should I purchase?

10. Where should inventory be transferred?

11. How much money is tied up in inventory?

12. What requires my attention today?



---



3. TARGET CUSTOMER



Primary ICP



Indian businesses with:



- 20–10,000 SKUs

- 1–20 warehouses/stores

- Multiple suppliers

- Online or offline sales

- Growing transaction volume

- Inventory worth ₹5 lakh+

- Need for inventory visibility

- Need for purchasing intelligence



Priority segments:



Segment A — D2C brands



Examples:



- Fashion

- Beauty

- Electronics

- Home

- Kitchen

- Fitness

- Pet products

- Lifestyle

- Consumer goods



Segment B — Omnichannel retailers



Segment C — Wholesalers/distributors



Segment D — Small manufacturers



Segment E — Multi-location businesses



---



4. INDIA-FIRST REQUIREMENTS



The product must be designed for Indian operational realities.



Support architecture for:



- INR

- GST

- GSTIN

- HSN/SAC

- CGST

- SGST

- IGST

- UTGST

- Tax-inclusive/exclusive pricing

- Indian states

- Indian PIN codes

- Indian phone numbers

- Indian financial years

- Indian invoice numbering

- Credit notes

- Debit notes

- Purchase invoices

- Sales invoices

- Payment tracking

- TDS/TCS-ready architecture

- E-commerce orders

- COD

- Returns

- Partial refunds

- Multiple payment methods



Do not hard-code Indian-specific logic into core business objects where it would prevent international expansion.



Create a tax/configuration abstraction layer.



---



5. PRODUCT MODULES



The platform consists of:



Public



1. Marketing website

2. Pricing

3. Product overview

4. Sign up

5. Login

6. Demo request

7. Documentation/help



SaaS application



8. Onboarding

9. Dashboard

10. AI Command Center

11. Products

12. Inventory

13. Warehouses

14. Barcode/QR scanning

15. Stock transfers

16. Stock adjustments

17. Suppliers

18. Purchase Orders

19. Receiving

20. Sales Orders

21. Returns

22. Invoices

23. Customers

24. Payments

25. Integrations

26. Accounting

27. Analytics

28. Forecasting

29. Alerts

30. Automations

31. Reports

32. Team

33. Roles & permissions

34. Organization settings

35. Customization

36. Audit logs

37. Billing/subscription architecture



---



6. PUBLIC LANDING PAGE



Create a polished SaaS landing page.



Hero



Headline:



Inventory that thinks ahead.



Subheadline:



StockPilot helps growing businesses manage inventory, purchasing, warehouses, sales channels and finances from one intelligent platform.



Primary CTA:



Start Free



Secondary CTA:



Book a Demo



Hero visual should show the actual StockPilot application.



---



7. LANDING PAGE SECTIONS



Include:



Hero



Trusted/compatible ecosystem



Show integration categories rather than falsely claiming specific partnerships.



Examples:



- E-commerce

- Marketplaces

- Accounting

- Payments

- Shipping

- Invoicing

- POS

- APIs



Problem section



"Your inventory is spread everywhere."



Product overview



- Inventory

- Procurement

- Omnichannel

- Finance

- Intelligence



AI section



Show examples:



«"You will run out of SKU-104 in 8 days."»



«"Transfer 120 units from Mumbai to Bengaluru instead of placing a new purchase order."»



«"₹2.4L is tied up in slow-moving inventory."»



Integrations



Security



Pricing



FAQ



Final CTA



---



8. SIGNUP



Users can create an account using:



- Email/password

- Google OAuth

- Other OAuth providers if configured



Signup should create:



1. User

2. Organization

3. Organization membership

4. Default role

5. Default settings

6. Default warehouse only after onboarding



The user must never access another organization's data.



---



9. MULTI-TENANT ARCHITECTURE



This is a critical requirement.



StockPilot is a true multi-tenant SaaS.



Every customer operates inside an isolated:



Organization / Tenant



Example:



StockPilot

│

├── Acme Beauty

│   ├── Users

│   ├── Products

│   ├── Warehouses

│   ├── Orders

│   └── Integrations

│

├── Urban Kitchen

│   ├── Users

│   ├── Products

│   ├── Warehouses

│   ├── Orders

│   └── Integrations

│

└── XYZ Electronics

    ├── Users

    ├── Products

    ├── Warehouses

    ├── Orders

    └── Integrations



Tenant data must be isolated using:



organization_id



plus PostgreSQL Row Level Security.



Never rely exclusively on frontend filtering.



---



10. TENANT CUSTOMIZATION



Each customer gets an individual portal.



Allow organization administrators to customize:



- Business name

- Logo

- Favicon

- Brand colors

- Invoice branding

- Email branding

- Default currency

- Timezone

- Date format

- Number format

- Tax settings

- Fiscal year

- Invoice numbering

- Warehouse defaults

- Notification preferences

- Dashboard layout

- Enabled modules



Architecture should allow future:



custom subdomain



Example:



acme.stockpilot.app



Do not require this for MVP, but build the architecture so it can be introduced later.



---



11. ORGANIZATION SWITCHING



A user may belong to multiple organizations.



Provide an organization switcher.



Example:



Acme Beauty

Urban Kitchen

XYZ Trading



Switching organizations must update all application context securely.



Never allow cross-tenant data leakage.



---



12. ORGANIZATION ROLES



Default roles:



Owner



Full access.



Admin



Full operational access except ownership/billing changes where restricted.



Inventory Manager



Inventory, products, warehouses, transfers, adjustments.



Procurement Manager



Suppliers, purchase orders, receiving.



Sales Manager



Orders, customers, returns.



Accountant



Invoices, payments, financial reports and accounting integrations.



Warehouse Operator



Scanning, receiving, picking, transfers and stock operations.



Viewer



Read-only.



---



13. CUSTOM PERMISSIONS



Create permission architecture rather than hard-coding only roles.



Permissions should follow:



module.action



Examples:



inventory.view

inventory.create

inventory.adjust

inventory.delete



products.view

products.create

products.edit



purchase_orders.view

purchase_orders.create

purchase_orders.approve



invoices.view

invoices.create

invoices.cancel



reports.view

settings.manage

integrations.manage



Admins can eventually create custom roles.



---



14. ONBOARDING



After signup:



Step 1



Business name



Step 2



Business type



- D2C

- Retail

- Wholesale

- Manufacturing

- Distribution

- Services + Products

- Other



Step 3



Number of SKUs



Step 4



Number of locations



Step 5



Sales channels



- Website

- Marketplace

- Retail store

- Sales team

- POS

- Manual



Step 6



Accounting system



Step 7



Import products



Options:



- CSV

- Excel

- Integration

- Manual



Step 8



Create warehouse



Step 9



Configure taxes



Step 10



Dashboard setup



Then:



«StockPilot is ready.»



---



15. DASHBOARD



Dashboard should be an operational command center.



KPI cards



- Inventory Value

- Available Stock

- Reserved Stock

- Incoming Stock

- Stockout Risks

- Excess Inventory

- Pending Purchases

- Sales Today



Inventory health



Show:



- Healthy

- Low stock

- Stockout risk

- Overstocked

- Dead stock



Attention Center



Critical:



- Products likely to stock out

- Overdue purchase orders

- Unusual inventory changes

- Failed integrations



AI Brief



Provide a natural-language daily summary.



---



16. PRODUCT MASTER



Product master must support:



- Product name

- SKU

- Barcode

- QR code

- Category

- Brand

- Description

- Images

- Product type

- Unit

- HSN

- GST rate

- Cost price

- Selling price

- MRP

- Minimum selling price

- Weight

- Dimensions

- Active/inactive

- Track inventory

- Track batch

- Track expiry

- Track serial number

- Reorder point

- Safety stock

- Lead time

- Preferred supplier



---



17. PRODUCT VARIANTS



Support:



- Size

- Color

- Material

- Model

- Pack size

- Custom attributes



Every variant may have:



- SKU

- Barcode

- Cost

- Price

- Inventory

- Supplier

- HSN

- Tax rate



---



18. BARCODE SYSTEM



The platform must support barcode scanning.



Support common barcode types through a configurable scanner layer.



Examples:



- EAN

- UPC

- Code 128

- Code 39

- QR



Do not assume every business uses the same barcode format.



Barcode must map to:



barcode

→ product_variant

→ SKU



---



19. MOBILE SCANNING



Create a mobile-friendly scanning interface.



Users can use device cameras to scan.



Primary scanning actions:



Receive Stock



Scan product → enter quantity → confirm.



Stock Count



Scan product → enter counted quantity.



Transfer



Scan products → choose destination → confirm.



Pick/Pack



Scan order → scan items → confirm.



Returns



Scan returned product → select reason → process.



Product Lookup



Scan barcode → immediately display:



- Product

- SKU

- Stock

- Locations

- Price

- Supplier



---



20. SCANNING WORKFLOW



Scanner interface:



SCAN

 ↓

IDENTIFY

 ↓

DISPLAY PRODUCT

 ↓

SELECT ACTION

 ↓

ENTER/CONFIRM QUANTITY

 ↓

VALIDATE

 ↓

COMMIT TRANSACTION

 ↓

UPDATE INVENTORY

 ↓

CREATE LEDGER ENTRY

 ↓

TRIGGER ALERTS



All inventory changes must create an immutable inventory movement record.



---



21. INVENTORY MODEL



Track separately:



- On hand

- Reserved

- Available

- Incoming

- Damaged

- Expired

- In transit



Formula:



Available =

On Hand

-

Reserved

-

Damaged

-

Expired



Incoming inventory must not be treated as available until received.



---



22. MULTI-WAREHOUSE



Each organization can have:



- Warehouses

- Stores

- Distribution centers

- Virtual locations



Warehouse fields:



- Name

- Code

- Address

- City

- State

- PIN

- Contact

- Capacity

- Active status



Inventory is maintained per warehouse.



---



23. STOCK TRANSFERS



Workflow:



Draft

→ Requested

→ Approved

→ In Transit

→ Received

→ Completed



Support:



- Full transfer

- Partial transfer

- Damaged transfer

- Transfer cancellation



Maintain both:



TRANSFER_OUT



and



TRANSFER_IN



ledger events.



---



24. STOCK ADJUSTMENTS



Authorized users can:



- Increase stock

- Decrease stock

- Mark damaged

- Mark expired

- Correct inventory



Every adjustment requires:



- Reason

- User

- Timestamp

- Before quantity

- Change

- After quantity



High-value adjustments should optionally require approval.



---



25. INVENTORY COUNTS



Support stock-taking.



Create:



Inventory Count Session



Fields:



- Warehouse

- User

- Start time

- End time

- Status



Scanner workflow:



Scan

→ Count

→ Compare

→ Variance

→ Approval

→ Adjustment



Show:



Expected: 100



Counted: 94



Variance: -6



Require reason before adjustment.



---



26. BATCH / LOT MANAGEMENT



Optional per product.



Fields:



- Batch number

- Manufacturing date

- Expiry date

- Quantity

- Supplier

- Cost

- Warehouse



Support FIFO/FEFO-ready architecture.



---



27. SERIAL NUMBER TRACKING



For products requiring serialized inventory.



Example:



Electronics.



Each serial number maps to:



- Product

- SKU

- Purchase order

- Supplier

- Warehouse

- Customer/order

- Warranty

- Status



Statuses:



- Available

- Reserved

- Sold

- Returned

- Damaged

- Warranty

- Lost



---



28. PROCUREMENT



Supplier management:



- Supplier name

- GSTIN

- Contact

- Email

- Phone

- Address

- Payment terms

- Lead time

- Minimum order quantity

- Rating

- Bank details placeholder architecture

- Supplier SKU

- Product cost



---



29. PURCHASE ORDERS



PO workflow:



Draft

→ Approval

→ Approved

→ Sent

→ Partially Received

→ Received

→ Closed



PO contains:



- Supplier

- Warehouse

- PO number

- Date

- Expected delivery

- Items

- Tax

- Discount

- Shipping

- Total

- Notes

- Attachments



---



30. GOODS RECEIVING



Receiving must support:



- Full receiving

- Partial receiving

- Damaged goods

- Short shipment

- Excess shipment

- Batch

- Expiry

- Serial numbers



When receiving:



1. Validate PO.

2. Update received quantity.

3. Update inventory.

4. Update incoming quantity.

5. Create inventory movement.

6. Update supplier metrics.

7. Trigger alerts if applicable.



---



31. SALES CHANNEL CONNECTION SYSTEM



Build a generic integration framework.



Architecture:



External Platform

        ↓

Connector

        ↓

Authentication

        ↓

Webhook/API Polling

        ↓

Integration Queue

        ↓

Normalization Layer

        ↓

StockPilot Objects



Do not tightly couple the core inventory system to any individual marketplace.



---



32. SELLING PORTALS / CHANNELS



Design integration framework for:



E-commerce



- Shopify

- WooCommerce

- Custom website/API



Marketplaces



Architecture should support Indian marketplace connectors such as:



- Amazon

- Flipkart

- Meesho



POS



Support future POS connectors.



Social commerce



Support future social-commerce connectors.



The exact connector availability should be controlled through configuration and credentials, not hard-coded assumptions.



---



33. INTEGRATION DATA MODEL



Every integration needs:



- Organization

- Provider

- Connection status

- Access credentials/tokens

- Token expiry

- Last synchronization

- Sync frequency

- Webhook status

- Error state

- Last error

- Sync cursor

- Configuration



Secrets must never be exposed to the frontend.



---



34. PRODUCT MAPPING



External products may not have identical SKUs.



Create:



integration_product_mappings



Fields:



- Integration

- External product ID

- External variant ID

- External SKU

- StockPilot product ID

- StockPilot variant ID

- Mapping status

- Last sync



Allow manual mapping.



Provide automatic SKU matching where safe.



---



35. INVENTORY SYNCHRONIZATION



Support:



Pull



External platform → StockPilot



Push



StockPilot → external platform



Bidirectional



Both directions.



Each connector must define its source-of-truth rules.



Never blindly overwrite inventory.



---



36. SYNC ENGINE



Create a background sync architecture.



States:



Queued

Processing

Completed

Failed

Retrying



Use:



- retry logic

- exponential backoff

- idempotency keys

- duplicate prevention

- sync logs



---



37. WEBHOOK ENGINE



Support incoming webhooks.



Example:



Order Created

Order Updated

Order Cancelled

Refund Created

Product Updated

Inventory Updated



Webhook events must be stored before processing.



Use event IDs to prevent duplicate processing.



---



38. ORDER MANAGEMENT



Sales orders should contain:



- Order number

- External order ID

- Customer

- Channel

- Warehouse

- Items

- Quantity

- Price

- Discount

- Tax

- Shipping

- Payment status

- Fulfillment status

- Order status



Statuses:



- Pending

- Confirmed

- Processing

- Packed

- Shipped

- Delivered

- Cancelled

- Returned



---



39. RETURNS



Support:



- Full return

- Partial return

- Damaged return

- Restock

- Non-restock

- Refund



Return reasons:



- Wrong item

- Damaged

- Customer changed mind

- Size issue

- Quality issue

- Other



---



40. INVOICING



Create an invoicing module.



Support:



- Sales invoices

- Purchase invoices

- Credit notes

- Debit notes

- Proforma invoices

- Payment status



Invoice fields:



- Invoice number

- Invoice date

- Customer

- GSTIN

- Billing address

- Shipping address

- Items

- HSN/SAC

- Quantity

- Rate

- Discount

- Tax

- CGST

- SGST

- IGST

- Total

- Payment status



---



41. GST ARCHITECTURE



Create configurable tax rules.



Support:



- GSTIN

- HSN

- SAC

- CGST

- SGST

- IGST

- UTGST

- Tax exemptions

- Zero-rated transactions

- Reverse-charge-ready architecture



Do not hard-code tax percentages into product logic.



Tax rates must be configurable.



---



42. ACCOUNTING INTEGRATIONS



Create generic accounting integration architecture.



Design connectors for systems commonly used by Indian businesses, including:



- Tally

- Zoho Books

- QuickBooks where applicable

- Other accounting APIs



Do not hard-code accounting-specific logic into invoices.



Create a mapping layer.



---



43. ACCOUNTING MAPPING



Map:



StockPilot Product

→ Accounting Product



StockPilot Customer

→ Accounting Customer



StockPilot Supplier

→ Accounting Supplier



StockPilot Tax

→ Accounting Tax



StockPilot Invoice

→ Accounting Invoice



StockPilot Payment

→ Accounting Payment



---



44. ACCOUNTING SYNC



Support:



- Customer sync

- Supplier sync

- Product sync

- Invoice sync

- Purchase invoice sync

- Credit note sync

- Payment sync

- Tax mapping



Display:



Last synced

Sync status

Errors

Retry



---



45. PAYMENTS



Architecture should support payment records.



Methods:



- Cash

- Bank transfer

- UPI

- Card

- COD

- Other



Payment fields:



- Amount

- Date

- Method

- Reference

- Status

- Invoice



---



46. AI INVENTORY INTELLIGENCE



The AI layer should provide:



Stockout prediction



Predict when products may reach zero.



Reorder recommendations



Recommend quantity and timing.



Excess inventory



Identify capital tied up.



Dead stock



Identify products with little/no movement.



Demand forecasting



Forecast:



- 7 days

- 30 days

- 60 days

- 90 days



Transfer recommendations



Recommend warehouse transfers.



Supplier intelligence



Identify supplier performance issues.



---



47. AI COMMAND CENTER



Persistent interface:



Ask StockPilot



Examples:



«What should I purchase this week?»



«Which products are at risk of stockout?»



«Why is inventory value increasing?»



«Which warehouse has the most excess stock?»



«Which supplier is performing poorly?»



«Show products with more than ₹1 lakh tied up.»



«What can I transfer instead of purchasing?»



---



48. AI ACTIONS



AI may eventually perform actions.



Examples:



- Create purchase order

- Create stock transfer

- Create alert

- Draft customer communication

- Generate report



But:



Never allow AI to execute financially consequential actions without explicit confirmation.



Use:



AI Recommendation

→ Preview

→ User Confirmation

→ Execute

→ Audit Log



---



49. FORECASTING ENGINE



Do not use an LLM for numerical calculations.



Forecast engine should use structured data.



Inputs:



- Historical sales

- Recent velocity

- Seasonality

- Day-of-week patterns

- Lead time

- Current stock

- Incoming stock

- Promotions if available



Outputs:



- predicted demand

- confidence interval

- stockout date

- reorder recommendation



---



50. REORDER FORMULA



Initial implementation:



Demand During Lead Time

+

Safety Stock

-

Available Stock

-

Incoming Stock

=

Recommended Purchase Quantity



Apply:



- MOQ

- supplier pack size

- rounding

- warehouse requirements



Store the reasoning.



---



51. ALERT ENGINE



Create a centralized alert system.



Alert types:



Inventory



- Low stock

- Stockout risk

- Overstock

- Dead stock

- Unusual adjustment

- Inventory variance



Procurement



- PO overdue

- Supplier delay

- Low supplier fill rate

- Price increase



Orders



- Failed synchronization

- Order cancellation

- Unfulfilled order



Integration



- Authentication failure

- API error

- Webhook failure

- Sync failure



Finance



- Invoice overdue

- Payment overdue

- Tax configuration issue



AI



- High-risk forecast

- Demand spike

- Demand collapse



---



52. ALERT SEVERITY



Levels:



INFO

WARNING

CRITICAL



Each alert should include:



- Title

- Description

- Entity

- Severity

- Timestamp

- Recommended action

- Status

- Assigned user

- Resolution

- Resolved timestamp



---



53. ALERT DELIVERY



Support:



In-app



Notification center.



Email



Configurable.



WhatsApp



Architecture-ready for supported

**Live app**: https://stockpilot-ai-ops.vercel.app

Deployed on Vercel, connected directly to this GitHub repository — push to `main` and it ships.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

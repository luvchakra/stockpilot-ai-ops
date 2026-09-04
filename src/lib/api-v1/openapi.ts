// Hand-written OpenAPI 3.0 spec for the public API v1 (SP-12). No
// secrets here, so this is safe to import from anywhere -- it's served
// verbatim at GET /api/v1/openapi.json (unauthenticated, like any API's
// own documentation) and rendered by the docs page.
export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "StockPilot Public API",
    version: "1.0.0",
    description:
      "Organization-scoped REST API for StockPilot. Authenticate with an API key generated from Organization Settings, sent as `Authorization: Bearer sk_live_...`. " +
      "A key can only do what the role that issued it could do in the app (see each endpoint's `x-permission`); reissue the key after a role change to pick up new access. " +
      "Rate limit: 120 requests/minute per organization (HTTP 429 once exceeded). " +
      "v1 covers reads and simple creates for the resources below; workflow actions (confirm/ship/approve/receive, generating invoices/credit notes, webhooks) are a planned fast-follow.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "http", scheme: "bearer", bearerFormat: "sk_live_..." },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: { code: { type: "string" }, message: { type: "string" } },
          },
        },
      },
      ListMeta: {
        type: "object",
        properties: {
          limit: { type: "integer" },
          offset: { type: "integer" },
          count: { type: "integer" },
        },
      },
    },
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    "/openapi.json": {
      get: {
        summary: "This document",
        security: [],
        responses: { "200": { description: "OpenAPI 3.0 document" } },
      },
    },
    "/products": {
      get: {
        summary: "List products",
        "x-permission": "none (any valid key)",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: { "200": { description: "OK" }, "401": { description: "Invalid/missing key" } },
      },
      post: {
        summary: "Create a product",
        "x-permission": "inventory.edit",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              example: { sku: "WIDGET-1", name: "Widget", selling_price: 199, unit: "pcs" },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
          "403": { description: "Missing permission" },
        },
      },
    },
    "/products/{id}": {
      get: {
        summary: "Get a product",
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } },
      },
      patch: {
        summary: "Update a product",
        "x-permission": "inventory.edit",
        responses: { "200": { description: "OK" } },
      },
    },
    "/warehouses": {
      get: { summary: "List warehouses", responses: { "200": { description: "OK" } } },
      post: {
        summary: "Create a warehouse",
        "x-permission": "inventory.edit",
        requestBody: {
          content: {
            "application/json": {
              example: { name: "Mumbai DC", code: "MUM-1", type: "warehouse" },
            },
          },
        },
        responses: { "201": { description: "Created" } },
      },
    },
    "/warehouses/{id}": {
      get: { summary: "Get a warehouse", responses: { "200": { description: "OK" } } },
      patch: {
        summary: "Update a warehouse",
        "x-permission": "inventory.edit",
        responses: { "200": { description: "OK" } },
      },
    },
    "/inventory": {
      get: {
        summary: "List stock levels (read-only)",
        parameters: [
          { name: "product_id", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "warehouse_id", in: "query", schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "OK" } },
      },
    },
    "/inventory/{id}": {
      get: {
        summary: "Get one stock_levels row by its id",
        responses: { "200": { description: "OK" } },
      },
    },
    "/purchase-orders": {
      get: {
        summary: "List purchase orders (with line items on single-fetch)",
        responses: { "200": { description: "OK" } },
      },
      post: {
        summary: "Create a draft purchase order",
        "x-permission": "purchase_orders.edit",
        requestBody: {
          content: {
            "application/json": {
              example: {
                supplier_id: "00000000-0000-0000-0000-000000000000",
                warehouse_id: "00000000-0000-0000-0000-000000000000",
                items: [
                  {
                    product_id: "00000000-0000-0000-0000-000000000000",
                    quantity: 10,
                    unit_cost: 50,
                  },
                ],
              },
            },
          },
        },
        responses: { "201": { description: "Created" } },
      },
    },
    "/purchase-orders/{id}": {
      get: {
        summary: "Get a purchase order with its line items",
        responses: { "200": { description: "OK" } },
      },
    },
    "/sales-orders": {
      get: {
        summary: "List sales orders (with line items on single-fetch)",
        responses: { "200": { description: "OK" } },
      },
      post: {
        summary: "Create a draft sales order",
        "x-permission": "sales_orders.edit",
        requestBody: {
          content: {
            "application/json": {
              example: {
                customer_id: "00000000-0000-0000-0000-000000000000",
                warehouse_id: "00000000-0000-0000-0000-000000000000",
                items: [
                  {
                    product_id: "00000000-0000-0000-0000-000000000000",
                    quantity: 2,
                    unit_price: 199,
                  },
                ],
              },
            },
          },
        },
        responses: { "201": { description: "Created" } },
      },
    },
    "/sales-orders/{id}": {
      get: {
        summary: "Get a sales order with its line items",
        responses: { "200": { description: "OK" } },
      },
    },
    "/customers": {
      get: { summary: "List customers", responses: { "200": { description: "OK" } } },
      post: {
        summary: "Create a customer",
        "x-permission": "customers.edit",
        requestBody: { content: { "application/json": { example: { name: "Acme Retail" } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/customers/{id}": {
      get: { summary: "Get a customer", responses: { "200": { description: "OK" } } },
      patch: {
        summary: "Update a customer",
        "x-permission": "customers.edit",
        responses: { "200": { description: "OK" } },
      },
    },
    "/suppliers": {
      get: { summary: "List suppliers", responses: { "200": { description: "OK" } } },
      post: {
        summary: "Create a supplier",
        "x-permission": "suppliers.edit",
        requestBody: { content: { "application/json": { example: { name: "Acme Wholesale" } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/suppliers/{id}": {
      get: { summary: "Get a supplier", responses: { "200": { description: "OK" } } },
      patch: {
        summary: "Update a supplier",
        "x-permission": "suppliers.edit",
        responses: { "200": { description: "OK" } },
      },
    },
    "/sales-invoices": {
      get: {
        summary: "List sales invoices (read-only)",
        responses: { "200": { description: "OK" } },
      },
    },
    "/sales-invoices/{id}": {
      get: {
        summary: "Get a sales invoice with its line items",
        responses: { "200": { description: "OK" } },
      },
    },
  },
} as const;

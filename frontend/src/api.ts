import { API_BASE_URL, apiFetch } from "./authTransport";

export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  reorderPoint: number;
  unitCost: number;
  location: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductQuery = {
  search?: string;
  category?: string;
  status?: "all" | "in-stock" | "low-stock" | "out-of-stock";
  page?: number;
  limit?: number;
  sortBy?: "name" | "sku" | "category" | "quantity" | "unitCost" | "updatedAt";
  sortOrder?: "asc" | "desc";
};

export type ProductListResponse = {
  data: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type ProductInput = {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  reorderPoint: number;
  unitCost: number;
  location: string;
};

export type StockMovement = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  movementType: string;
  quantityDelta: number;
  quantityAfter: number;
  reason: string;
  createdAt: string;
};

export type DashboardSummary = {
  metrics: {
    productCount: number;
    totalUnits: number;
    inventoryValue: number;
    lowStockCount: number;
    outOfStockCount: number;
  };
  attentionProducts: Product[];
  recentActivity: StockMovement[];
  weeklyActivity: { day: string; units: number }[];
};

export type Supplier = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SupplierInput = {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
};

export type SupplierUpdate = Partial<SupplierInput> & {
  isActive?: boolean;
};

export type SupplierQuery = {
  search?: string;
  status?: "all" | "active" | "inactive";
  page?: number;
  limit?: number;
};

export type PurchaseOrderStatus =
  | "draft"
  | "ordered"
  | "partially_received"
  | "received"
  | "cancelled";

export type PurchaseOrderItem = {
  id: string;
  purchaseOrderId: string;
  productId: string;
  sku: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityOutstanding: number;
  unitCost: number;
  lineTotal: number;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseOrder = {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  expectedDate: string | null;
  orderedAt: string | null;
  notes: string | null;
  itemCount: number;
  totalCost: number;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseOrderDetail = PurchaseOrder & {
  items: PurchaseOrderItem[];
};

export type PurchaseOrderQuery = {
  search?: string;
  status?: "all" | PurchaseOrderStatus;
  page?: number;
  limit?: number;
};

export type CreatePurchaseOrderInput = {
  supplierId: string;
  expectedDate: string | null;
  notes: string | null;
  items: {
    productId: string;
    quantityOrdered: number;
    unitCost: number;
  }[];
};

export type ReceiptItemInput = {
  purchaseOrderItemId: string;
  quantityReceived: number;
};

export type ReceiptResult = {
  receiptId: string;
  purchaseOrderId: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  receiptReference: string | null;
  notes: string | null;
  receivedAt: string;
  items: {
    purchaseOrderItemId: string;
    productId: string;
    sku: string;
    productName: string;
    quantityReceived: number;
    quantityAfter: number;
  }[];
};

export type PurchaseOrderReceipt = {
  id: string;
  purchaseOrderId: string;
  receiptReference: string | null;
  notes: string | null;
  receivedAt: string;
  createdAt: string;
  items: {
    id: string;
    purchaseOrderItemId: string;
    productId: string;
    sku: string;
    productName: string;
    quantityReceived: number;
  }[];
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

type ListResponse<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await apiFetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      "Could not connect to the SupplyDesk API. Check that the backend is running on port 3001.",
    );
  }

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    // Retain a useful HTTP error if the server response is not JSON.
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;

    throw new Error(
      body?.error?.message ??
        `The request failed with HTTP ${response.status}.`,
    );
  }

  return payload as T;
}

function buildQuery(values: object): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (key === "status" && value === "all") {
      continue;
    }

    params.set(key, String(value));
  }

  const query = params.toString();

  return query ? `?${query}` : "";
}

// Products ----------------------------------------------------

export async function getProducts(
  query: ProductQuery = {},
): Promise<ProductListResponse> {
  return request<ProductListResponse>(
    `/products${buildQuery(query)}`,
  );
}

export async function createProduct(
  input: ProductInput,
): Promise<Product> {
  const result = await request<{ data: Product }>("/products", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return result.data;
}

export async function getProductCategories(): Promise<string[]> {
  const result = await request<{ data: string[] }>(
    "/products/categories",
  );

  return result.data;
}

export async function getProductMovements(
  productId: string,
): Promise<StockMovement[]> {
  const result = await request<ListResponse<StockMovement>>(
    `/products/${encodeURIComponent(productId)}/movements?limit=100`,
  );

  return result.data;
}

// Dashboard ---------------------------------------------------

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const result = await request<{ data: DashboardSummary }>(
    "/dashboard/summary",
  );

  return result.data;
}

// Suppliers ---------------------------------------------------

export async function getSuppliers(
  query: SupplierQuery = {},
): Promise<ListResponse<Supplier>> {
  return request<ListResponse<Supplier>>(
    `/suppliers${buildQuery(query)}`,
  );
}

export async function createSupplier(
  input: SupplierInput,
): Promise<Supplier> {
  const result = await request<{ data: Supplier }>("/suppliers", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return result.data;
}

export async function updateSupplier(
  id: string,
  input: SupplierUpdate,
): Promise<Supplier> {
  const result = await request<{ data: Supplier }>(
    `/suppliers/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );

  return result.data;
}

// Purchase orders --------------------------------------------

export async function getPurchaseOrders(
  query: PurchaseOrderQuery = {},
): Promise<ListResponse<PurchaseOrder>> {
  return request<ListResponse<PurchaseOrder>>(
    `/purchase-orders${buildQuery(query)}`,
  );
}

export async function getPurchaseOrder(
  id: string,
): Promise<PurchaseOrderDetail> {
  const result = await request<{ data: PurchaseOrderDetail }>(
    `/purchase-orders/${encodeURIComponent(id)}`,
  );

  return result.data;
}

export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
): Promise<PurchaseOrderDetail> {
  const result = await request<{ data: PurchaseOrderDetail }>(
    "/purchase-orders",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );

  return result.data;
}

export async function placePurchaseOrder(
  id: string,
): Promise<PurchaseOrderDetail> {
  const result = await request<{ data: PurchaseOrderDetail }>(
    `/purchase-orders/${encodeURIComponent(id)}/place`,
    { method: "POST" },
  );

  return result.data;
}

export async function cancelPurchaseOrder(
  id: string,
): Promise<PurchaseOrderDetail> {
  const result = await request<{ data: PurchaseOrderDetail }>(
    `/purchase-orders/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  );

  return result.data;
}

export async function createPurchaseReceipt(
  orderId: string,
  input: {
    receiptReference: string | null;
    notes: string | null;
    items: ReceiptItemInput[];
  },
): Promise<ReceiptResult> {
  const result = await request<{ data: ReceiptResult }>(
    `/purchase-orders/${encodeURIComponent(orderId)}/receipts`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );

  return result.data;
}

export async function getPurchaseOrderReceipts(
  orderId: string,
): Promise<PurchaseOrderReceipt[]> {
  const result = await request<{ data: PurchaseOrderReceipt[] }>(
    `/purchase-orders/${encodeURIComponent(orderId)}/receipts`,
  );

  return result.data;
}
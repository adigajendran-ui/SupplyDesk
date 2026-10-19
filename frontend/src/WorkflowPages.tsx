import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";

import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  createPurchaseReceipt,
  createSupplier,
  getDashboardSummary,
  getProductMovements,
  getProducts,
  getPurchaseOrder,
  getPurchaseOrders,
  getPurchaseOrderReceipts,
  getSuppliers,
  placePurchaseOrder,
  updateSupplier,
  type DashboardSummary,
  type Product,
  type PurchaseOrder,
  type PurchaseOrderDetail,
  type PurchaseOrderQuery,
  type PurchaseOrderReceipt,
  type ReceiptItemInput,
  type StockMovement,
  type Supplier,
  type SupplierInput,
  type SupplierQuery,
} from "./api";

import "./WorkflowPages.css";

export type WorkflowPageView =
  | "suppliers"
  | "purchasing"
  | "activity"
  | "reports"
  | "settings";

type Props = {
  view: WorkflowPageView;
  onDataChanged: () => void;
};

type SupplierForm = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
};

type OrderLineDraft = {
  productId: string;
  quantityOrdered: string;
  unitCost: string;
};

const blankSupplierForm: SupplierForm = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
};

function toSupplierInput(form: SupplierForm): SupplierInput {
  return {
    name: form.name.trim(),
    contactName: form.contactName.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    address: form.address.trim() || null,
    notes: form.notes.trim() || null,
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "—";

  const date = new Date(`${value.slice(0, 10)}T00:00:00`);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString();
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatStatus(status: string): string {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusClass(status: string): string {
  return status.toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  if (!message) return null;

  return (
    <div className="workflow-error" role="alert">
      <AlertTriangle size={17} />
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss error">
        <X size={15} />
      </button>
    </div>
  );
}

function LoadingOrEmpty({
  loading,
  empty,
  loadingText = "Loading records...",
  emptyText,
}: {
  loading: boolean;
  empty: boolean;
  loadingText?: string;
  emptyText: string;
}) {
  if (!loading && !empty) return null;

  return (
    <div className="workflow-empty">
      {loading ? <RefreshCw size={23} /> : <ClipboardList size={23} />}
      <strong>{loading ? "Loading" : "Nothing here yet"}</strong>
      <span>{loading ? loadingText : emptyText}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <article className="workflow-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </article>
  );
}

const purchaseStatusOptions: {
  value: NonNullable<PurchaseOrderQuery["status"]>;
  label: string;
}[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "ordered", label: "Ordered" },
  { value: "partially_received", label: "Partially received" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];

export function WorkflowPages({ view, onDataChanged }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierStatus, setSupplierStatus] =
    useState<NonNullable<SupplierQuery["status"]>>("active");
  const [isSupplierLoading, setIsSupplierLoading] = useState(false);
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [supplierForm, setSupplierForm] =
    useState<SupplierForm>(blankSupplierForm);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatus, setOrderStatus] =
    useState<NonNullable<PurchaseOrderQuery["status"]>>("all");
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [isProductOptionsLoading, setIsProductOptionsLoading] =
    useState(false);

  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [orderSupplierId, setOrderSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [orderLines, setOrderLines] = useState<OrderLineDraft[]>([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(
    null,
  );
  const [selectedOrder, setSelectedOrder] =
    useState<PurchaseOrderDetail | null>(null);
  const [orderReceipts, setOrderReceipts] =
    useState<PurchaseOrderReceipt[]>([]);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const [receivingOrder, setReceivingOrder] =
    useState<PurchaseOrderDetail | null>(null);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [receiptReference, setReceiptReference] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [receiptQuantities, setReceiptQuantities] =
    useState<Record<string, string>>({});
  const [isSavingReceipt, setIsSavingReceipt] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [isActivityLoading, setIsActivityLoading] = useState(false);

  // Load suppliers. The purchasing form needs active suppliers;
  // the supplier page can search and inspect active or inactive records.
  useEffect(() => {
    if (view !== "suppliers" && view !== "purchasing") return;

    let cancelled = false;

    async function loadSuppliers(): Promise<void> {
      setIsSupplierLoading(true);

      try {
        const result = await getSuppliers({
          search:
            view === "suppliers"
              ? supplierSearch.trim() || undefined
              : undefined,
          status: view === "suppliers" ? supplierStatus : "active",
          page: 1,
          limit: 100,
        });

        if (!cancelled) {
          setSuppliers(result.data);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load suppliers.",
          );
        }
      } finally {
        if (!cancelled) setIsSupplierLoading(false);
      }
    }

    void loadSuppliers();

    return () => {
      cancelled = true;
    };
  }, [view, supplierSearch, supplierStatus, reloadKey]);

  // Load order list for the purchasing screen.
  useEffect(() => {
    if (view !== "purchasing") return;

    let cancelled = false;

    async function loadOrders(): Promise<void> {
      setIsOrdersLoading(true);

      try {
        const result = await getPurchaseOrders({
          search: orderSearch.trim() || undefined,
          status: orderStatus,
          page: 1,
          limit: 100,
        });

        if (!cancelled) {
          setOrders(result.data);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load purchase orders.",
          );
        }
      } finally {
        if (!cancelled) setIsOrdersLoading(false);
      }
    }

    const timer = window.setTimeout(() => {
      void loadOrders();
    }, orderSearch.trim() ? 200 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [view, orderSearch, orderStatus, reloadKey]);

  // Fetch product choices from the database for purchase-order lines.
  useEffect(() => {
    if (view !== "purchasing") return;

    let cancelled = false;

    async function loadProducts(): Promise<void> {
      setIsProductOptionsLoading(true);

      try {
        const result = await getProducts({
          page: 1,
          limit: 100,
          sortBy: "name",
          sortOrder: "asc",
        });

        if (!cancelled) {
          setProducts(result.data);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load product choices.",
          );
        }
      } finally {
        if (!cancelled) setIsProductOptionsLoading(false);
      }
    }

    void loadProducts();

    return () => {
      cancelled = true;
    };
  }, [view, reloadKey]);

  // Fetch detail and receipt history when an order is opened.
  useEffect(() => {
    if (view !== "purchasing" || !selectedOrderId || !isDetailOpen) {
      return;
    }

    let cancelled = false;

    async function loadOrderDetails(): Promise<void> {
      setIsDetailLoading(true);
      setSelectedOrder(null);
      setOrderReceipts([]);

      try {
        const [order, receipts] = await Promise.all([
          getPurchaseOrder(selectedOrderId!),
          getPurchaseOrderReceipts(selectedOrderId!),
        ]);

        if (!cancelled) {
          setSelectedOrder(order);
          setOrderReceipts(receipts);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load purchase-order details.",
          );
        }
      } finally {
        if (!cancelled) setIsDetailLoading(false);
      }
    }

    void loadOrderDetails();

    return () => {
      cancelled = true;
    };
  }, [view, selectedOrderId, isDetailOpen, reloadKey]);

  // Load the dashboard summary for activity and reporting.
  useEffect(() => {
    if (view !== "activity" && view !== "reports") return;

    let cancelled = false;

    async function loadActivity(): Promise<void> {
      setIsActivityLoading(true);

      try {
        const summary = await getDashboardSummary();

        if (cancelled) return;

        setDashboard(summary);

        if (view === "activity") {
          const productResult = await getProducts({
            page: 1,
            limit: 100,
          });

            const movementResults = await Promise.all(
            productResult.data.map(async (product) => {
              const productMovements = await getProductMovements(product.id);

              return productMovements.map((movement) => ({
                ...movement,
                productName: product.name,
                sku: product.sku,
              }));
            }),
          );

          if (!cancelled) {
            setMovements(
              movementResults
                .flat()
                .sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime(),
                )
                .slice(0, 100),
            );
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load inventory activity.",
          );
        }
      } finally {
        if (!cancelled) setIsActivityLoading(false);
      }
    }

    void loadActivity();

    return () => {
      cancelled = true;
    };
  }, [view, reloadKey]);

  function changed(): void {
    setReloadKey((current) => current + 1);
    onDataChanged();
  }

  function openSupplierForm(): void {
    setSupplierForm(blankSupplierForm);
    setError("");
    setNotice("");
    setIsSupplierModalOpen(true);
  }

  async function handleCreateSupplier(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!supplierForm.name.trim()) {
      setError("Supplier name is required.");
      return;
    }

    setIsSavingSupplier(true);

    try {
      const supplier = await createSupplier(toSupplierInput(supplierForm));

      setIsSupplierModalOpen(false);
      setSupplierForm(blankSupplierForm);
      setNotice(`Supplier "${supplier.name}" was created successfully.`);
      changed();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the supplier.",
      );
    } finally {
      setIsSavingSupplier(false);
    }
  }

  async function toggleSupplierStatus(supplier: Supplier): Promise<void> {
    setError("");
    setNotice("");
    setBusyAction(`supplier:${supplier.id}`);

    try {
      await updateSupplier(supplier.id, {
        isActive: !supplier.isActive,
      });

      setNotice(
        supplier.isActive
          ? `${supplier.name} has been deactivated.`
          : `${supplier.name} has been reactivated.`,
      );

      changed();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update the supplier.",
      );
    } finally {
      setBusyAction("");
    }
  }

  function openOrderForm(): void {
    setError("");
    setNotice("");

    if (suppliers.length === 0) {
      setError("Create an active supplier before creating a purchase order.");
      return;
    }

    if (products.length === 0) {
      setError("Add a product to inventory before creating a purchase order.");
      return;
    }

    setOrderSupplierId(suppliers[0].id);
    setExpectedDate("");
    setOrderNotes("");
    setOrderLines([
      {
        productId: products[0].id,
        quantityOrdered: "1",
        unitCost: products[0].unitCost.toFixed(2),
      },
    ]);
    setIsOrderModalOpen(true);
  }

  function updateOrderLine(
    index: number,
    field: keyof OrderLineDraft,
    value: string,
  ): void {
    setOrderLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;

        if (field === "productId") {
          const product = products.find((item) => item.id === value);

          return {
            ...line,
            productId: value,
            unitCost:
              product?.unitCost !== undefined
                ? product.unitCost.toFixed(2)
                : line.unitCost,
          };
        }

        return { ...line, [field]: value };
      }),
    );
  }

  function addOrderLine(): void {
    const unusedProduct = products.find(
      (product) =>
        !orderLines.some((line) => line.productId === product.id),
    );

    setOrderLines((current) => [
      ...current,
      {
        productId: unusedProduct?.id ?? products[0]?.id ?? "",
        quantityOrdered: "1",
        unitCost: (unusedProduct?.unitCost ?? products[0]?.unitCost ?? 0).toFixed(
          2,
        ),
      },
    ]);
  }

  async function handleCreateOrder(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!orderSupplierId) {
      setError("Select a supplier.");
      return;
    }

    if (orderLines.length === 0) {
      setError("Add at least one product to the purchase order.");
      return;
    }

    const parsedLines = orderLines.map((line) => ({
      productId: line.productId,
      quantityOrdered: Number(line.quantityOrdered),
      unitCost: Number(line.unitCost),
    }));

    if (
            parsedLines.some(
        (line) =>
          !line.productId ||
          !Number.isInteger(line.quantityOrdered) ||
          line.quantityOrdered <= 0 ||
          line.quantityOrdered > 2_147_483_647 ||
          !Number.isFinite(line.unitCost) ||
          line.unitCost < 0 ||
          line.unitCost > 9_999_999_999.99 ||
          Math.abs(
            line.unitCost * 100 - Math.round(line.unitCost * 100),
          ) > 0.000001,
      )
    ) {
      setError("Each order line needs a product, positive whole quantity, and valid cost.");
      return;
    }

    if (
      new Set(parsedLines.map((line) => line.productId)).size !==
      parsedLines.length
    ) {
      setError("Each product can appear only once per purchase order.");
      return;
    }

    setIsSavingOrder(true);

    try {
      const order = await createPurchaseOrder({
        supplierId: orderSupplierId,
        expectedDate: expectedDate || null,
        notes: orderNotes.trim() || null,
        items: parsedLines,
      });

      setIsOrderModalOpen(false);
      setNotice(`Draft ${order.orderNumber} was created.`);
      setSelectedOrderId(order.id);
      setIsDetailOpen(true);
      changed();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the purchase order.",
      );
    } finally {
      setIsSavingOrder(false);
    }
  }

  async function handlePlaceOrder(order: PurchaseOrder): Promise<void> {
    setError("");
    setNotice("");
    setBusyAction(`place:${order.id}`);

    try {
      const placed = await placePurchaseOrder(order.id);

      setNotice(`${placed.orderNumber} has been placed.`);
      changed();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not place the purchase order.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleCancelOrder(order: PurchaseOrder): Promise<void> {
    const accepted = window.confirm(
      `Cancel ${order.orderNumber}? This cannot be undone.`,
    );

    if (!accepted) return;

    setError("");
    setNotice("");
    setBusyAction(`cancel:${order.id}`);

    try {
      const cancelledOrder = await cancelPurchaseOrder(order.id);

      setNotice(`${cancelledOrder.orderNumber} was cancelled.`);
      changed();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not cancel the purchase order.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function openReceiptForm(orderId: string): Promise<void> {
    setError("");
    setNotice("");
    setBusyAction(`load-receipt:${orderId}`);

    try {
      const order = await getPurchaseOrder(orderId);

      if (
        order.status !== "ordered" &&
        order.status !== "partially_received"
      ) {
        setError("Only placed or partially received orders can receive stock.");
        return;
      }

      setReceivingOrder(order);
      setReceiptReference("");
      setReceiptNotes("");
      setReceiptQuantities(
        Object.fromEntries(
          order.items.map((item) => [item.id, "0"]),
        ),
      );
      setIsReceiveModalOpen(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load the purchase order for receiving.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateReceipt(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!receivingOrder) return;

    const items: ReceiptItemInput[] = receivingOrder.items
      .map((item) => ({
        purchaseOrderItemId: item.id,
        quantityReceived: Number(receiptQuantities[item.id] ?? "0"),
        outstanding: item.quantityOutstanding,
      }))
      .filter((item) => item.quantityReceived > 0)
      .map((item) => ({
        purchaseOrderItemId: item.purchaseOrderItemId,
        quantityReceived: item.quantityReceived,
      }));

    if (items.length === 0) {
      setError("Enter a quantity greater than zero for at least one item.");
      return;
    }

    if (
      items.some(
        (item) =>
          !Number.isInteger(item.quantityReceived) ||
          item.quantityReceived <= 0,
      )
    ) {
      setError("Received quantities must be positive whole numbers.");
      return;
    }

    const exceedsOutstanding = items.some((received) => {
      const item = receivingOrder.items.find(
        (line) => line.id === received.purchaseOrderItemId,
      );

      return (
        !item ||
        received.quantityReceived > item.quantityOutstanding
      );
    });

    if (exceedsOutstanding) {
      setError("A received quantity cannot exceed the outstanding order quantity.");
      return;
    }

    setIsSavingReceipt(true);

    try {
      const result = await createPurchaseReceipt(receivingOrder.id, {
        receiptReference: receiptReference.trim() || null,
        notes: receiptNotes.trim() || null,
        items,
      });

      setIsReceiveModalOpen(false);
      setReceivingOrder(null);
      setNotice(
        `Receipt recorded for ${result.orderNumber}. Status: ${formatStatus(result.status)}.`,
      );
      changed();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not record the receipt.",
      );
    } finally {
      setIsSavingReceipt(false);
    }
  }

  const activeSupplierCount = suppliers.filter(
    (supplier) => supplier.isActive,
  ).length;

  if (view === "suppliers") {
    return (
      <section className="workflow-page">
        <div className="workflow-heading">
          <div className="workflow-heading-icon">
            <Truck size={23} />
          </div>

          <div>
            <h2>Supplier directory</h2>
            <p>
              Manage supplier contacts and control which suppliers can be used
              for new orders.
            </p>
          </div>

          <button
            type="button"
            className="button button-primary workflow-heading-action"
            onClick={openSupplierForm}
          >
            <Plus size={16} />
            Add supplier
          </button>
        </div>

        <ErrorBanner message={error} onDismiss={() => setError("")} />

        {notice && (
          <div className="workflow-success" role="status">
            <CheckCircle2 size={16} />
            {notice}
            <button
              type="button"
              onClick={() => setNotice("")}
              aria-label="Dismiss success message"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="workflow-toolbar">
          <label className="workflow-search">
            <Search size={16} />
            <input
              aria-label="Search suppliers"
              placeholder="Search by name, contact, email, or phone..."
              value={supplierSearch}
              onChange={(event) => setSupplierSearch(event.target.value)}
            />
          </label>

          <select
            aria-label="Filter suppliers by status"
            value={supplierStatus}
            onChange={(event) =>
              setSupplierStatus(
                event.target.value as NonNullable<SupplierQuery["status"]>,
              )
            }
          >
            <option value="active">Active suppliers</option>
            <option value="inactive">Inactive suppliers</option>
            <option value="all">All suppliers</option>
          </select>
        </div>

        <div className="workflow-summary-row">
          <StatCard
            label="Suppliers listed"
            value={formatNumber(suppliers.length)}
            caption="Matching current filters"
          />

          <StatCard
            label="Active in current list"
            value={formatNumber(activeSupplierCount)}
            caption="Available for purchasing"
          />
        </div>

        <section className="panel workflow-table-panel">
          <div className="workflow-panel-heading">
            <div>
              <h3>Suppliers</h3>
              <p>Contacts saved in PostgreSQL</p>
            </div>

            <span className="workflow-subtle">
              {isSupplierLoading ? "Refreshing..." : "Live data"}
            </span>
          </div>

          <div className="workflow-table-wrap">
            <table className="workflow-table">
              <thead>
                <tr>
                  <th>SUPPLIER</th>
                  <th>CONTACT</th>
                  <th>EMAIL</th>
                  <th>PHONE</th>
                  <th>STATUS</th>
                  <th>ACTION</th>
                </tr>
              </thead>

              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <div className="workflow-primary-cell">
                        <span className="workflow-avatar">
                          {supplier.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          <strong>{supplier.name}</strong>
                          <small>
                            Added {formatDate(supplier.createdAt)}
                          </small>
                        </span>
                      </div>
                    </td>

                    <td>{supplier.contactName || "—"}</td>
                    <td>{supplier.email || "—"}</td>
                    <td>{supplier.phone || "—"}</td>

                    <td>
                      <span
                        className={`workflow-badge ${
                          supplier.isActive ? "active" : "inactive"
                        }`}
                      >
                        <span />
                        {supplier.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>

                    <td>
                      <button
                        type="button"
                        className="workflow-text-button"
                        disabled={busyAction === `supplier:${supplier.id}`}
                        onClick={() => void toggleSupplierStatus(supplier)}
                      >
                        {busyAction === `supplier:${supplier.id}`
                          ? "Saving..."
                          : supplier.isActive
                            ? "Deactivate"
                            : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <LoadingOrEmpty
            loading={isSupplierLoading}
            empty={suppliers.length === 0}
            loadingText="Retrieving suppliers from PostgreSQL..."
            emptyText="Add a supplier to begin creating purchase orders."
          />
        </section>

        {isSupplierModalOpen && (
          <div
            className="workflow-modal-backdrop"
            onClick={() => {
              if (!isSavingSupplier) setIsSupplierModalOpen(false);
            }}
            role="presentation"
          >
            <section
              className="workflow-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="supplier-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="workflow-modal-heading">
                <div>
                  <span className="workflow-eyebrow">
                    PURCHASING DIRECTORY
                  </span>
                  <h2 id="supplier-modal-title">Add supplier</h2>
                  <p>Enter the supplier's business and contact details.</p>
                </div>

                <button
                  className="icon-button"
                  type="button"
                  disabled={isSavingSupplier}
                  onClick={() => setIsSupplierModalOpen(false)}
                  aria-label="Close supplier form"
                >
                  <X size={17} />
                </button>
              </div>

              <form
                onSubmit={(event) => void handleCreateSupplier(event)}
              >
                <div className="workflow-form-grid">
                  <label className="workflow-field workflow-field-full">
                    <span>Supplier name *</span>
                    <input
                      required
                      maxLength={160}
                      value={supplierForm.name}
                      onChange={(event) =>
                        setSupplierForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="e.g. Acme Components Ltd."
                    />
                  </label>

                  <label className="workflow-field">
                    <span>Contact name</span>
                    <input
                      maxLength={120}
                      value={supplierForm.contactName}
                      onChange={(event) =>
                        setSupplierForm((current) => ({
                          ...current,
                          contactName: event.target.value,
                        }))
                      }
                      placeholder="Contact person"
                    />
                  </label>

                  <label className="workflow-field">
                    <span>Work email</span>
                    <input
                      type="email"
                      maxLength={254}
                      value={supplierForm.email}
                      onChange={(event) =>
                        setSupplierForm((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      placeholder="orders@example.com"
                    />
                  </label>

                  <label className="workflow-field">
                    <span>Phone</span>
                    <input
                      maxLength={40}
                      value={supplierForm.phone}
                      onChange={(event) =>
                        setSupplierForm((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                      placeholder="Contact number"
                    />
                  </label>

                  <label className="workflow-field">
                    <span>Address</span>
                    <input
                      maxLength={2000}
                      value={supplierForm.address}
                      onChange={(event) =>
                        setSupplierForm((current) => ({
                          ...current,
                          address: event.target.value,
                        }))
                      }
                      placeholder="Business address"
                    />
                  </label>

                  <label className="workflow-field workflow-field-full">
                    <span>Notes</span>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={supplierForm.notes}
                      onChange={(event) =>
                        setSupplierForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Optional purchasing notes"
                    />
                  </label>
                </div>

                {error && <p className="workflow-inline-error">{error}</p>}

                <div className="workflow-modal-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={isSavingSupplier}
                    onClick={() => setIsSupplierModalOpen(false)}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={isSavingSupplier}
                  >
                    {isSavingSupplier ? "Saving..." : "Save supplier"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </section>
    );
  }

  if (view === "purchasing") {
    return (
      <section className="workflow-page">
        <div className="workflow-heading">
          <div className="workflow-heading-icon">
            <ShoppingCart size={23} />
          </div>

          <div>
            <h2>Purchase orders</h2>
            <p>
              Create orders, place them with suppliers, and receive deliveries
              without exceeding ordered quantities.
            </p>
          </div>

          <button
            type="button"
            className="button button-primary workflow-heading-action"
            onClick={openOrderForm}
            disabled={isProductOptionsLoading || isSupplierLoading}
          >
            <Plus size={16} />
            New purchase order
          </button>
        </div>

        <ErrorBanner message={error} onDismiss={() => setError("")} />

        {notice && (
          <div className="workflow-success" role="status">
            <CheckCircle2 size={16} />
            {notice}
            <button
              type="button"
              onClick={() => setNotice("")}
              aria-label="Dismiss success message"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="workflow-summary-row">
          <StatCard
            label="Purchase orders"
            value={formatNumber(orders.length)}
            caption="Matching current filters"
          />

          <StatCard
            label="Awaiting delivery"
            value={formatNumber(
              orders.filter(
                (order) =>
                  order.status === "ordered" ||
                  order.status === "partially_received",
              ).length,
            )}
            caption="Placed or partially received"
          />

          <StatCard
            label="Order value"
            value={formatCurrency(
              orders.reduce((sum, order) => sum + order.totalCost, 0),
            )}
            caption="Value of listed orders"
          />
        </div>

        <section className="panel workflow-table-panel">
          <div className="workflow-panel-heading">
            <div>
              <h3>Order register</h3>
              <p>Supplier commitments and receiving progress</p>
            </div>

            <span className="workflow-subtle">
              {isOrdersLoading ? "Refreshing..." : "Live data"}
            </span>
          </div>

          <div className="workflow-toolbar workflow-toolbar-orders">
            <label className="workflow-search">
              <Search size={16} />
              <input
                aria-label="Search purchase orders"
                placeholder="Search order number or supplier..."
                value={orderSearch}
                onChange={(event) => setOrderSearch(event.target.value)}
              />
            </label>

            <select
              aria-label="Filter purchase orders by status"
              value={orderStatus}
              onChange={(event) =>
                setOrderStatus(
                  event.target.value as NonNullable<
                    PurchaseOrderQuery["status"]
                  >,
                )
              }
            >
              {purchaseStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="workflow-table-wrap">
            <table className="workflow-table">
              <thead>
                <tr>
                  <th>ORDER</th>
                  <th>SUPPLIER</th>
                  <th>EXPECTED</th>
                  <th>ITEMS</th>
                  <th>ORDER VALUE</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>

              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <div className="workflow-order-number">
                        <strong>{order.orderNumber}</strong>
                        <small>Created {formatDate(order.createdAt)}</small>
                      </div>
                    </td>

                    <td>{order.supplierName}</td>
                    <td>{formatDate(order.expectedDate)}</td>
                    <td>{order.itemCount}</td>
                    <td className="workflow-money">
                      {formatCurrency(order.totalCost)}
                    </td>

                    <td>
                      <span
                        className={`workflow-badge ${statusClass(
                          order.status,
                        )}`}
                      >
                        <span />
                        {formatStatus(order.status)}
                      </span>
                    </td>

                    <td>
                      <div className="workflow-row-actions">
                        <button
                          type="button"
                          className="workflow-text-button"
                          onClick={() => {
                            setSelectedOrderId(order.id);
                            setIsDetailOpen(true);
                            setError("");
                          }}
                        >
                          Details
                        </button>

                        {order.status === "draft" && (
                          <>
                            <button
                              type="button"
                              className="workflow-text-button"
                              disabled={busyAction === `place:${order.id}`}
                              onClick={() => void handlePlaceOrder(order)}
                            >
                              {busyAction === `place:${order.id}`
                                ? "Placing..."
                                : "Place"}
                            </button>

                            <button
                              type="button"
                              className="workflow-text-button danger"
                              disabled={busyAction === `cancel:${order.id}`}
                              onClick={() => void handleCancelOrder(order)}
                            >
                              Cancel
                            </button>
                          </>
                        )}

                        {order.status === "ordered" && (
                          <>
                            <button
                              type="button"
                              className="workflow-text-button"
                              disabled={busyAction === `load-receipt:${order.id}`}
                              onClick={() => void openReceiptForm(order.id)}
                            >
                              Receive
                            </button>

                            <button
                              type="button"
                              className="workflow-text-button danger"
                              disabled={busyAction === `cancel:${order.id}`}
                              onClick={() => void handleCancelOrder(order)}
                            >
                              Cancel
                            </button>
                          </>
                        )}

                        {order.status === "partially_received" && (
                          <button
                            type="button"
                            className="workflow-text-button"
                            disabled={busyAction === `load-receipt:${order.id}`}
                            onClick={() => void openReceiptForm(order.id)}
                          >
                            Receive more
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <LoadingOrEmpty
            loading={isOrdersLoading}
            empty={orders.length === 0}
            loadingText="Retrieving purchase orders..."
            emptyText="Create a draft order to start the purchasing workflow."
          />
        </section>

        {isOrderModalOpen && (
          <div
            className="workflow-modal-backdrop"
            onClick={() => {
              if (!isSavingOrder) setIsOrderModalOpen(false);
            }}
            role="presentation"
          >
            <section
              className="workflow-modal workflow-modal-wide"
              role="dialog"
              aria-modal="true"
              aria-labelledby="order-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="workflow-modal-heading">
                <div>
                  <span className="workflow-eyebrow">PURCHASING</span>
                  <h2 id="order-modal-title">New purchase order</h2>
                  <p>
                    This creates a draft. Inventory does not change until
                    deliveries are received.
                  </p>
                </div>

                <button
                  className="icon-button"
                  type="button"
                  disabled={isSavingOrder}
                  onClick={() => setIsOrderModalOpen(false)}
                  aria-label="Close purchase order form"
                >
                  <X size={17} />
                </button>
              </div>

              {products.length === 0 && (
                <p className="workflow-inline-error">
                  Add inventory products before creating an order.
                </p>
              )}

              {suppliers.length === 0 && (
                <p className="workflow-inline-error">
                  Create an active supplier before creating an order.
                </p>
              )}

              <form onSubmit={(event) => void handleCreateOrder(event)}>
                <div className="workflow-form-grid">
                  <label className="workflow-field">
                    <span>Supplier *</span>
                    <select
                      required
                      value={orderSupplierId}
                      onChange={(event) =>
                        setOrderSupplierId(event.target.value)
                      }
                    >
                      <option value="">Select supplier</option>
                      {suppliers
                        .filter((supplier) => supplier.isActive)
                        .map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="workflow-field">
                    <span>Expected delivery date</span>
                    <input
                      type="date"
                      value={expectedDate}
                      onChange={(event) => setExpectedDate(event.target.value)}
                    />
                  </label>

                  <label className="workflow-field workflow-field-full">
                    <span>Order notes</span>
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={orderNotes}
                      onChange={(event) => setOrderNotes(event.target.value)}
                      placeholder="Optional supplier instructions"
                    />
                  </label>
                </div>

                <div className="workflow-line-heading">
                  <div>
                    <h3>Order items</h3>
                    <p>Each product can appear once per order.</p>
                  </div>

                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={addOrderLine}
                    disabled={
                      orderLines.length >= products.length ||
                      products.length === 0
                    }
                  >
                    <Plus size={15} />
                    Add line
                  </button>
                </div>

                <div className="workflow-order-line-list">
                  {orderLines.map((line, index) => (
                    <div className="workflow-order-line" key={index}>
                      <label className="workflow-field">
                        <span>Product</span>
                        <select
                          required
                          value={line.productId}
                          onChange={(event) =>
                            updateOrderLine(
                              index,
                              "productId",
                              event.target.value,
                            )
                          }
                        >
                          {products.map((product) => (
                            <option
                              key={product.id}
                              value={product.id}
                              disabled={orderLines.some(
                                (otherLine, otherIndex) =>
                                  otherIndex !== index &&
                                  otherLine.productId === product.id,
                              )}
                            >
                              {product.sku} — {product.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="workflow-field">
                        <span>Quantity</span>
                        <input
                          required
                          type="number"
                          min="1"
                          max="2147483647"
                          step="1"
                          value={line.quantityOrdered}
                          onChange={(event) =>
                            updateOrderLine(
                              index,
                              "quantityOrdered",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="workflow-field">
                        <span>Unit cost (USD)</span>
                        <input
                          required
                          type="number"
                          min="0"
                          max="9999999999.99"
                          step="0.01"
                          value={line.unitCost}
                          onChange={(event) =>
                            updateOrderLine(
                              index,
                              "unitCost",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <button
                        type="button"
                        className="workflow-remove-line"
                        disabled={orderLines.length === 1}
                        onClick={() =>
                          setOrderLines((current) =>
                            current.filter((_, lineIndex) => lineIndex !== index),
                          )
                        }
                        aria-label={`Remove item line ${index + 1}`}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="workflow-order-total">
                  <span>Draft order value</span>
                  <strong>
                    {formatCurrency(
                      orderLines.reduce(
                        (sum, line) =>
                          sum +
                          Math.max(0, Number(line.quantityOrdered) || 0) *
                            Math.max(0, Number(line.unitCost) || 0),
                        0,
                      ),
                    )}
                  </strong>
                </div>

                <div className="workflow-modal-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={isSavingOrder}
                    onClick={() => setIsOrderModalOpen(false)}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={
                      isSavingOrder ||
                      products.length === 0 ||
                      suppliers.filter((supplier) => supplier.isActive)
                        .length === 0
                    }
                  >
                    {isSavingOrder ? "Creating..." : "Create draft"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {isDetailOpen && (
          <div
            className="workflow-modal-backdrop"
            onClick={() => setIsDetailOpen(false)}
            role="presentation"
          >
            <section
              className="workflow-modal workflow-modal-wide"
              role="dialog"
              aria-modal="true"
              aria-labelledby="order-detail-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="workflow-modal-heading">
                <div>
                  <span className="workflow-eyebrow">
                    PURCHASE ORDER DETAILS
                  </span>
                  <h2 id="order-detail-title">
                    {selectedOrder?.orderNumber ?? "Purchase order"}
                  </h2>
                  <p>
                    Review line items, outstanding quantities, and delivery
                    receipts.
                  </p>
                </div>

                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setIsDetailOpen(false)}
                  aria-label="Close purchase order details"
                >
                  <X size={17} />
                </button>
              </div>

              {isDetailLoading && (
                <div className="workflow-empty">
                  <RefreshCw size={23} />
                  <strong>Loading order details</strong>
                </div>
              )}

              {selectedOrder && (
                <>
                  <div className="workflow-detail-grid">
                    <div>
                      <span>Supplier</span>
                      <strong>{selectedOrder.supplierName}</strong>
                    </div>

                    <div>
                      <span>Status</span>
                      <strong>
                        {formatStatus(selectedOrder.status)}
                      </strong>
                    </div>

                    <div>
                      <span>Expected delivery</span>
                      <strong>
                        {formatDate(selectedOrder.expectedDate)}
                      </strong>
                    </div>

                    <div>
                      <span>Order value</span>
                      <strong>
                        {formatCurrency(selectedOrder.totalCost)}
                      </strong>
                    </div>
                  </div>

                  <div className="workflow-panel-heading">
                    <div>
                      <h3>Order lines</h3>
                      <p>Ordered and received quantities</p>
                    </div>
                  </div>

                  <div className="workflow-table-wrap">
                    <table className="workflow-table">
                      <thead>
                        <tr>
                          <th>PRODUCT</th>
                          <th>ORDERED</th>
                          <th>RECEIVED</th>
                          <th>OUTSTANDING</th>
                          <th>UNIT COST</th>
                        </tr>
                      </thead>

                      <tbody>
                        {selectedOrder.items.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.productName}</strong>
                              <small className="workflow-cell-subtitle">
                                {item.sku}
                              </small>
                            </td>
                            <td>{item.quantityOrdered}</td>
                            <td>{item.quantityReceived}</td>
                            <td>{item.quantityOutstanding}</td>
                            <td>{formatCurrency(item.unitCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="workflow-panel-heading receipt-history-heading">
                    <div>
                      <h3>Delivery history</h3>
                      <p>Receipts recorded against this order</p>
                    </div>
                  </div>

                  {orderReceipts.length === 0 ? (
                    <p className="workflow-muted-text">
                      No deliveries have been recorded yet.
                    </p>
                  ) : (
                    <div className="workflow-receipt-list">
                      {orderReceipts.map((receipt) => (
                        <article
                          className="workflow-receipt-card"
                          key={receipt.id}
                        >
                          <div className="workflow-receipt-heading">
                            <strong>
                              {receipt.receiptReference ||
                                "Receipt without reference"}
                            </strong>
                            <span>{formatTimestamp(receipt.receivedAt)}</span>
                          </div>

                          <div className="workflow-receipt-items">
                            {receipt.items.map((item) => (
                              <span key={item.id}>
                                {item.productName}: +
                                {item.quantityReceived}
                              </span>
                            ))}
                          </div>

                          {receipt.notes && <p>{receipt.notes}</p>}
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        {isReceiveModalOpen && receivingOrder && (
          <div
            className="workflow-modal-backdrop"
            onClick={() => {
              if (!isSavingReceipt) setIsReceiveModalOpen(false);
            }}
            role="presentation"
          >
            <section
              className="workflow-modal workflow-modal-wide"
              role="dialog"
              aria-modal="true"
              aria-labelledby="receive-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="workflow-modal-heading">
                <div>
                  <span className="workflow-eyebrow">INVENTORY RECEIVING</span>
                  <h2 id="receive-modal-title">
                    Receive {receivingOrder.orderNumber}
                  </h2>
                  <p>
                    Only received quantities will be added to inventory. Leave
                    unreceived items at zero.
                  </p>
                </div>

                <button
                  className="icon-button"
                  type="button"
                  disabled={isSavingReceipt}
                  onClick={() => setIsReceiveModalOpen(false)}
                  aria-label="Close receiving form"
                >
                  <X size={17} />
                </button>
              </div>

              <form onSubmit={(event) => void handleCreateReceipt(event)}>
                <div className="workflow-form-grid">
                  <label className="workflow-field">
                    <span>Receipt reference</span>
                    <input
                      maxLength={100}
                      value={receiptReference}
                      onChange={(event) =>
                        setReceiptReference(event.target.value)
                      }
                      placeholder="Optional delivery note number"
                    />
                  </label>

                  <label className="workflow-field">
                    <span>Receipt notes</span>
                    <input
                      maxLength={1000}
                      value={receiptNotes}
                      onChange={(event) => setReceiptNotes(event.target.value)}
                      placeholder="Optional receiving notes"
                    />
                  </label>
                </div>

                <div className="workflow-panel-heading">
                  <div>
                    <h3>Items received</h3>
                    <p>
                      Quantity cannot exceed the outstanding order amount.
                    </p>
                  </div>
                </div>

                <div className="workflow-table-wrap">
                  <table className="workflow-table">
                    <thead>
                      <tr>
                        <th>PRODUCT</th>
                        <th>OUTSTANDING</th>
                        <th>RECEIVING NOW</th>
                      </tr>
                    </thead>

                    <tbody>
                      {receivingOrder.items
                        .filter((item) => item.quantityOutstanding > 0)
                        .map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.productName}</strong>
                              <small className="workflow-cell-subtitle">
                                {item.sku}
                              </small>
                            </td>

                            <td>{item.quantityOutstanding}</td>

                            <td>
                              <input
                                className="workflow-quantity-input"
                                type="number"
                                min="0"
                                max={item.quantityOutstanding}
                                step="1"
                                required
                                aria-label={`Quantity received for ${item.sku}`}
                                value={receiptQuantities[item.id] ?? "0"}
                                onChange={(event) =>
                                  setReceiptQuantities((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {receivingOrder.items.every(
                  (item) => item.quantityOutstanding === 0,
                ) && (
                  <p className="workflow-muted-text">
                    This order has no remaining outstanding quantities.
                  </p>
                )}

                {error && <p className="workflow-inline-error">{error}</p>}

                <div className="workflow-modal-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={isSavingReceipt}
                    onClick={() => setIsReceiveModalOpen(false)}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={isSavingReceipt}
                  >
                    {isSavingReceipt ? "Recording..." : "Record receipt"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </section>
    );
  }

  if (view === "activity") {
    return (
      <section className="workflow-page">
        <div className="workflow-heading">
          <div className="workflow-heading-icon">
            <Activity size={23} />
          </div>
          <div>
            <h2>Stock movement history</h2>
            <p>
              Recent recorded inventory changes, with reasons and before/after
              quantities.
            </p>
          </div>
        </div>

        <ErrorBanner message={error} onDismiss={() => setError("")} />

        <section className="panel workflow-table-panel">
          <div className="workflow-panel-heading">
            <div>
              <h3>Inventory ledger</h3>
              <p>Latest movements across the first 100 listed products</p>
            </div>

            <button
              type="button"
              className="button button-secondary"
              onClick={() => setReloadKey((current) => current + 1)}
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          <div className="workflow-table-wrap">
            <table className="workflow-table">
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>PRODUCT</th>
                  <th>TYPE</th>
                  <th>CHANGE</th>
                  <th>QUANTITY AFTER</th>
                  <th>REASON</th>
                </tr>
              </thead>

              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatTimestamp(movement.createdAt)}</td>
                    <td>
                      <strong>{movement.productName}</strong>
                      <small className="workflow-cell-subtitle">
                        {movement.sku}
                      </small>
                    </td>
                    <td>{formatStatus(movement.movementType)}</td>
                    <td
                      className={
                        movement.quantityDelta > 0
                          ? "workflow-positive"
                          : "workflow-negative"
                      }
                    >
                      {movement.quantityDelta > 0 ? "+" : ""}
                      {movement.quantityDelta}
                    </td>
                    <td>{movement.quantityAfter}</td>
                    <td>{movement.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <LoadingOrEmpty
            loading={isActivityLoading}
            empty={movements.length === 0}
            emptyText="No stock movement records were found."
            loadingText="Loading the inventory ledger..."
          />
        </section>
      </section>
    );
  }

  if (view === "reports") {
    return (
      <section className="workflow-page">
        <div className="workflow-heading">
          <div className="workflow-heading-icon">
            <Activity size={23} />
          </div>

          <div>
            <h2>Inventory reports</h2>
            <p>Summary metrics calculated from your current inventory.</p>
          </div>
        </div>

        <ErrorBanner message={error} onDismiss={() => setError("")} />

        {!dashboard && (
          <LoadingOrEmpty
            loading={isActivityLoading}
            empty
            emptyText="No report data is available."
          />
        )}

        {dashboard && (
          <>
            <div className="workflow-summary-row">
              <StatCard
                label="Tracked products"
                value={formatNumber(dashboard.metrics.productCount)}
                caption="Distinct product records"
              />

              <StatCard
                label="Total units"
                value={formatNumber(dashboard.metrics.totalUnits)}
                caption="Current units on hand"
              />

              <StatCard
                label="Inventory value"
                value={formatCurrency(dashboard.metrics.inventoryValue)}
                caption="Quantity multiplied by unit cost"
              />

              <StatCard
                label="Needs attention"
                value={formatNumber(
                  dashboard.metrics.lowStockCount +
                    dashboard.metrics.outOfStockCount,
                )}
                caption="Low or out of stock"
              />
            </div>

            <section className="panel workflow-report-panel">
              <div className="workflow-panel-heading">
                <div>
                  <h3>Stock movement by day</h3>
                  <p>Recorded units moved in the last seven calendar days</p>
                </div>
              </div>

              <div className="workflow-report-bars">
                {dashboard.weeklyActivity.map((day) => {
                  const maximum = Math.max(
                    1,
                    ...dashboard.weeklyActivity.map((item) => item.units),
                  );

                  return (
                    <div className="workflow-report-bar-column" key={day.day}>
                      <strong>{formatNumber(day.units)}</strong>
                      <div className="workflow-report-bar-track">
                        <div
                          className="workflow-report-bar"
                          style={{
                            height: `${(day.units / maximum) * 100}%`,
                          }}
                        />
                      </div>
                      <span>{day.day}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="workflow-page">
      <div className="workflow-heading">
        <div className="workflow-heading-icon">
          <SettingsIcon />
        </div>

        <div>
          <h2>Workspace settings</h2>
          <p>
            Authentication, user roles, and organization-level settings will be
            added in a later milestone.
          </p>
        </div>
      </div>

      <section className="panel workflow-settings-card">
        <div className="workflow-settings-icon">
          <CheckCircle2 size={24} />
        </div>
        <h3>Local development workspace</h3>
        <p>
          Supplier, inventory, and purchasing operations use the SupplyDesk API
          and PostgreSQL database. User authentication and access controls are
          not implemented yet, so this build is intended for local development,
          not public or multi-user deployment.
        </p>
      </section>
    </section>
  );
}

function SettingsIcon() {
  return <Package size={23} />;
}
import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Download,
  LayoutDashboard,
  Package,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  createProduct,
  getDashboardSummary,
  getProductCategories,
  getProducts,
  type DashboardSummary,
  type Product,
  type ProductQuery,
} from "./api";

import "./App.css";

import {
  WorkflowPages,
  type WorkflowPageView,
} from "./WorkflowPages";

type View =
  | "overview"
  | "inventory"
  | "purchasing"
  | "suppliers"
  | "activity"
  | "reports"
  | "settings";

type ProductForm = {
  sku: string;
  name: string;
  category: string;
  quantity: string;
  reorderPoint: string;
  unitCost: string;
  location: string;
};

type NavigationItem = {
  id: View;
  label: string;
  icon: LucideIcon;
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

const navigationGroups: NavigationGroup[] = [
  {
    label: "WORKSPACE",
    items: [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: "inventory", label: "Inventory", icon: Boxes },
      { id: "purchasing", label: "Purchasing", icon: ShoppingCart },
      { id: "suppliers", label: "Suppliers", icon: Truck },
      { id: "activity", label: "Stock movements", icon: Activity },
    ],
  },
  {
    label: "ANALYTICS",
    items: [{ id: "reports", label: "Reports", icon: BarChart3 }],
  },
  {
    label: "ADMINISTRATION",
    items: [{ id: "settings", label: "Settings", icon: Settings }],
  },
];

const initialForm: ProductForm = {
  sku: "",
  name: "",
  category: "Electronics",
  quantity: "0",
  reorderPoint: "10",
  unitCost: "0",
  location: "Warehouse A",
};

const pageDetails: Record<View, { title: string; subtitle: string }> = {
  overview: {
    title: "Inventory overview",
    subtitle: "A clear picture of your inventory and purchasing activity.",
  },
  inventory: {
    title: "Inventory",
    subtitle: "Manage products, stock levels, and reorder thresholds.",
  },
  purchasing: {
    title: "Purchasing",
    subtitle: "Manage purchase orders and incoming inventory.",
  },
  suppliers: {
    title: "Suppliers",
    subtitle: "Keep supplier information organized in one place.",
  },
  activity: {
    title: "Stock movements",
    subtitle: "Review inventory changes and their recorded reasons.",
  },
  reports: {
    title: "Reports",
    subtitle: "Understand stock levels and purchasing patterns.",
  },
  settings: {
    title: "Settings",
    subtitle: "Manage your workspace preferences and access.",
  },
};

const statusOptions = [
  { value: "all", label: "All stock status" },
  { value: "in-stock", label: "In stock" },
  { value: "low-stock", label: "Low stock" },
  { value: "out-of-stock", label: "Out of stock" },
] as const;

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatNumber(amount: number): string {
  return new Intl.NumberFormat("en-US").format(amount);
}

function getStockStatus(product: Product): string {
  if (product.quantity <= 0) {
    return "Out of stock";
  }

  if (product.quantity <= product.reorderPoint) {
    return "Low stock";
  }

  return "In stock";
}

function getStatusClass(product: Product): string {
  return getStockStatus(product).toLowerCase().replaceAll(" ", "-");
}

function formatMovementType(type: string): string {
  return type.replaceAll("_", " ").replace(/\b\w/g, (character) =>
    character.toUpperCase(),
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function App() {
  const [activeView, setActiveView] = useState<View>("overview");

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<ProductQuery["status"]>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(initialForm);
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);

  const [isProductsLoading, setIsProductsLoading] = useState(true);
  const [productError, setProductError] = useState("");
  const [dashboardError, setDashboardError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Load the product list from PostgreSQL through the backend API.
  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void (async () => {
        setIsProductsLoading(true);
        setProductError("");
        setProducts([]);

        try {
          const result = await getProducts({
            search: search.trim() || undefined,
            category:
              categoryFilter === "all" ? undefined : categoryFilter,
            status: statusFilter ?? "all",
            page,
            limit: 10,
            sortBy: "updatedAt",
            sortOrder: "desc",
          });

          if (cancelled) {
            return;
          }

          setProducts(result.data);
          setTotalProducts(result.pagination.total);
          setTotalPages(result.pagination.totalPages);
        } catch (error) {
          if (cancelled) {
            return;
          }

          setProductError(
            error instanceof Error
              ? error.message
              : "Could not load inventory.",
          );

          setProducts([]);
          setTotalProducts(0);
          setTotalPages(0);
        } finally {
          if (!cancelled) {
            setIsProductsLoading(false);
          }
        }
      })();
    }, search.trim() ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, categoryFilter, statusFilter, page, refreshKey]);

  // Fetch aggregate metrics, recent movements, and category options.
  useEffect(() => {
    let cancelled = false;

    async function loadDashboard(): Promise<void> {
      try {
        const [summary, loadedCategories] = await Promise.all([
          getDashboardSummary(),
          getProductCategories(),
        ]);

        if (cancelled) {
          return;
        }

        setDashboard(summary);
        setCategories(loadedCategories);
        setDashboardError("");
      } catch (error) {
        if (!cancelled) {
          setDashboardError(
            error instanceof Error
              ? error.message
              : "Could not load dashboard data.",
          );
        }
      }
    }

    void loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const currentPage = pageDetails[activeView];

  const filteredProducts = products;
  const lowStockProducts = dashboard?.attentionProducts ?? [];
  const recentActivity = dashboard?.recentActivity ?? [];
  const weeklyActivity = dashboard?.weeklyActivity ?? [];

  const totalUnits = dashboard?.metrics.totalUnits ?? 0;
  const inventoryValue = dashboard?.metrics.inventoryValue ?? 0;

  const attentionCount =
    (dashboard?.metrics.lowStockCount ?? 0) +
    (dashboard?.metrics.outOfStockCount ?? 0);

  const maxWeeklyUnits = Math.max(
    0,
    ...weeklyActivity.map((day) => day.units),
  );

  const categoryOptions = categories;

  function updateForm(field: keyof ProductForm, value: string): void {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function openAddProduct(): void {
    setForm(initialForm);
    setFormError("");
    setIsSaving(false);
    setIsAddOpen(true);
  }

  async function handleAddProduct(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setFormError("");

    const normalizedSku = form.sku.trim().toUpperCase();
    const quantity = Number(form.quantity);
    const reorderPoint = Number(form.reorderPoint);
    const unitCost = Number(form.unitCost);

    if (
      !normalizedSku ||
      !form.name.trim() ||
      !form.location.trim()
    ) {
      setFormError("Product name, SKU, and location are required.");
      return;
    }

    if (
      !Number.isInteger(quantity) ||
      !Number.isInteger(reorderPoint) ||
      quantity < 0 ||
      reorderPoint < 0 ||
      quantity > 2_147_483_647 ||
      reorderPoint > 2_147_483_647 ||
      !Number.isFinite(unitCost) ||
      unitCost < 0 ||
      unitCost > 9_999_999_999.99
    ) {
      setFormError(
        "Quantities must be valid non-negative whole numbers. Unit cost must be a valid non-negative amount.",
      );
      return;
    }

    setIsSaving(true);

    try {
      await createProduct({
        sku: normalizedSku,
        name: form.name.trim(),
        category: form.category.trim(),
        quantity,
        reorderPoint,
        unitCost,
        location: form.location.trim(),
      });

      setIsAddOpen(false);
      setForm(initialForm);
      setSearch("");
      setStatusFilter("all");
      setCategoryFilter("all");
      setPage(1);
      setActiveView("inventory");

      // Reload inventory and dashboard from the database.
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "The product could not be saved.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExportCsv(): Promise<void> {
    setProductError("");

    try {
      const exportQuery: ProductQuery = {
        page: 1,
        limit: 100,
        sortBy: "updatedAt",
        sortOrder: "desc",
      };

      if (activeView === "inventory") {
        exportQuery.search = search.trim() || undefined;
        exportQuery.category =
          categoryFilter === "all" ? undefined : categoryFilter;
        exportQuery.status = statusFilter ?? "all";
      }

      const firstPage = await getProducts(exportQuery);
      const rows = [...firstPage.data];

      // Fetch remaining pages so the export includes all matching records.
      for (
        let exportPage = 2;
        exportPage <= firstPage.pagination.totalPages;
        exportPage += 1
      ) {
        const result = await getProducts({
          ...exportQuery,
          page: exportPage,
        });

        rows.push(...result.data);
      }

      const headers = [
        "SKU",
        "Product",
        "Category",
        "Quantity",
        "Reorder Point",
        "Unit Cost",
        "Inventory Value",
        "Status",
        "Location",
      ];

      const escapeCsvCell = (value: string | number): string => {
        const text = String(value);

        // Guard against spreadsheet formula injection from text fields.
        const safeText = /^[\t\r ]*[=+\-@]/.test(text)
          ? `'${text}`
          : text;

        return `"${safeText.replaceAll('"', '""')}"`;
      };

      const csvRows = [
        headers.map(escapeCsvCell).join(","),
        ...rows.map((product) =>
          [
            product.sku,
            product.name,
            product.category,
            product.quantity,
            product.reorderPoint,
            product.unitCost.toFixed(2),
            (product.quantity * product.unitCost).toFixed(2),
            getStockStatus(product),
            product.location,
          ]
            .map(escapeCsvCell)
            .join(","),
        ),
      ];

      const blob = new Blob(["\uFEFF" + csvRows.join("\r\n")], {
        type: "text/csv;charset=utf-8;",
      });

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = "supplydesk-inventory.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setProductError(
        error instanceof Error
          ? `CSV export failed: ${error.message}`
          : "CSV export failed.",
      );
    }
  }

  const statCards = [
    {
      label: "Inventory value",
      value: dashboard ? formatCurrency(inventoryValue) : "—",
      detail: "Current stock at recorded unit cost",
      icon: CircleDollarSign,
      tone: "mint",
    },
    {
      label: "Units on hand",
      value: dashboard ? formatNumber(totalUnits) : "—",
      detail: "Across all tracked products",
      icon: Boxes,
      tone: "blue",
    },
    {
      label: "Products tracked",
      value: dashboard
        ? formatNumber(dashboard.metrics.productCount)
        : "—",
      detail: "Records stored in PostgreSQL",
      icon: Package,
      tone: "purple",
    },
    {
      label: "Needs attention",
      value: dashboard ? formatNumber(attentionCount) : "—",
      detail: dashboard
        ? `${dashboard.metrics.lowStockCount} low stock · ${dashboard.metrics.outOfStockCount} out of stock`
        : "Loading stock status",
      icon: AlertTriangle,
      tone: "amber",
    },
  ];

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">
              <Boxes size={23} strokeWidth={2.2} />
            </div>

            <div className="brand-copy">
              <span className="brand-name">supplydesk</span>
              <span className="brand-tagline">INVENTORY OPERATIONS</span>
            </div>
          </div>

          <div className="workspace-picker">
            <div className="workspace-avatar">AC</div>

            <div className="workspace-copy">
              <span className="workspace-name">Acme Supply Co.</span>
              <span className="workspace-type">Local workspace</span>
            </div>

            <ChevronDown size={15} />
          </div>

          <nav className="sidebar-nav" aria-label="Main navigation">
            {navigationGroups.map((group) => (
              <div className="nav-group" key={group.label}>
                <p className="nav-section-label">{group.label}</p>

                {group.items.map((item) => {
                  const Icon = item.icon;

                  return (
                    <button
                      className={`nav-item ${
                        activeView === item.id ? "active" : ""
                      }`}
                      key={item.id}
                      type="button"
                      onClick={() => setActiveView(item.id)}
                      aria-current={
                        activeView === item.id ? "page" : undefined
                      }
                    >
                      <Icon size={18} strokeWidth={1.9} />
                      <span className="nav-text">{item.label}</span>

                      {item.id === "inventory" && (
                        <span className="nav-count">
                          {dashboard?.metrics.productCount ??
                            totalProducts}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <div className="help-card">
              <div className="help-card-icon">
                <CheckCircle2 size={17} />
              </div>

              <div className="help-card-copy">
                <strong>Local workspace</strong>
                <span>Inventory API connected</span>
              </div>
            </div>

            <div className="sidebar-profile">
              <div className="profile-avatar">AD</div>

              <div className="profile-copy">
                <span className="profile-name">Demo Admin</span>
                <span className="profile-role">Local demo profile</span>
              </div>
            </div>
          </div>
        </aside>

        <div className="main-shell">
          <header className="topbar">
            <div className="mobile-brand">
              <div className="brand-mark">
                <Boxes size={21} />
              </div>
              <span className="brand-name">supplydesk</span>
            </div>

            <div className="topbar-search">
              <Search size={18} />

              <input
                type="search"
                aria-label="Search products"
                placeholder="Search products, SKUs, categories..."
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setActiveView("inventory");
                  }
                }}
              />

              <kbd>↵</kbd>
            </div>

            <div className="topbar-right">
              <span className="demo-pill">
                <span className="demo-dot" />
                {dashboard
                  ? "DATABASE CONNECTED"
                  : dashboardError
                    ? "API UNAVAILABLE"
                    : "CONNECTING"}
              </span>

              <button
                className="icon-button notification-button"
                type="button"
                aria-label="View stock movements"
                title="View stock movements"
                onClick={() => setActiveView("activity")}
              >
                <Bell size={19} />
                <span className="notification-dot" />
              </button>

              <div className="topbar-divider" />

              <div className="topbar-user">
                <div className="profile-avatar">AD</div>

                <div className="profile-copy">
                  <span className="profile-name">Demo Admin</span>
                  <span className="profile-role">Local profile</span>
                </div>

                <ChevronDown size={15} className="user-chevron" />
              </div>
            </div>
          </header>

          <main className="main-content">
            <div className="page-heading">
              <div className="page-heading-copy">
                <div className="breadcrumb">
                  <span>Workspace</span>
                  <span className="breadcrumb-slash">/</span>
                  <span className="breadcrumb-current">
                    {currentPage.title}
                  </span>
                </div>

                <h1>{currentPage.title}</h1>
                <p>{currentPage.subtitle}</p>
              </div>

              {(activeView === "overview" ||
                activeView === "inventory") && (
                <div className="page-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void handleExportCsv()}
                  >
                    <Download size={16} />
                    <span>Export CSV</span>
                  </button>

                  <button
                    className="button button-primary"
                    type="button"
                    onClick={openAddProduct}
                  >
                    <Plus size={17} />
                    <span>Add product</span>
                  </button>
                </div>
              )}
            </div>

            {(dashboardError || productError) && (
              <div className="api-error-banner" role="alert">
                <div>
                  {dashboardError && (
                    <p>
                      <strong>Dashboard:</strong> {dashboardError}
                    </p>
                  )}

                  {productError && (
                    <p>
                      <strong>Inventory:</strong> {productError}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setRefreshKey((current) => current + 1)
                  }
                >
                  Retry
                </button>
              </div>
            )}

            {activeView === "overview" && (
              <>
                <section
                  className="metrics-grid"
                  aria-label="Inventory metrics"
                >
                  {statCards.map((stat) => {
                    const Icon = stat.icon;

                    return (
                      <article className="metric-card" key={stat.label}>
                        <div className="metric-top">
                          <span className="metric-label">
                            {stat.label}
                          </span>

                          <span className={`metric-icon ${stat.tone}`}>
                            <Icon size={19} strokeWidth={1.9} />
                          </span>
                        </div>

                        <strong className="metric-value">
                          {stat.value}
                        </strong>

                        <span className="metric-detail">
                          {stat.detail}
                        </span>
                      </article>
                    );
                  })}
                </section>

                <section className="overview-grid">
                  <article className="panel stock-chart-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Stock activity</h2>
                        <p>
                          Recorded inventory movement over the last seven
                          calendar days
                        </p>
                      </div>

                      <button
                        className="period-selector"
                        type="button"
                        onClick={() => setActiveView("activity")}
                      >
                        This week <ChevronDown size={15} />
                      </button>
                    </div>

                    <div className="chart-summary">
                      <div>
                        <strong>Daily stock movements</strong>

                        <span className="chart-summary-note">
                          <Activity size={14} />
                          Live database data
                        </span>
                      </div>

                      <span className="chart-legend">
                        <span className="legend-dot" />
                        Units moved
                      </span>
                    </div>

                    <div
                      className="chart-bars"
                      role="img"
                      aria-label="Stock movement totals from recorded database movements during the last seven calendar days"
                    >
                      {weeklyActivity.map((day) => {
                        const barHeight =
                          maxWeeklyUnits > 0 && day.units > 0
                            ? Math.max(
                                5,
                                (day.units / maxWeeklyUnits) * 100,
                              )
                            : 0;

                        return (
                          <div className="chart-column" key={day.day}>
                            <div className="chart-bar-track">
                              <div
                                className="chart-bar"
                                style={{ height: `${barHeight}%` }}
                                title={`${day.day}: ${formatNumber(day.units)} units moved`}
                              />
                            </div>

                            <span className="chart-day">{day.day}</span>
                          </div>
                        );
                      })}
                    </div>

                    <p className="chart-disclaimer">
                      Totals are calculated from recorded PostgreSQL
                      stock movements. New movement records will update
                      this chart when the dashboard refreshes.
                    </p>
                  </article>

                  <article className="panel attention-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Needs attention</h2>
                        <p>
                          Products at or below their reorder threshold
                        </p>
                      </div>

                      <span className="attention-count">
                        {formatNumber(attentionCount)}
                      </span>
                    </div>

                    <div className="attention-list">
                      {lowStockProducts.slice(0, 4).map((product) => (
                        <div
                          className="attention-item"
                          key={product.id}
                        >
                          <div className="attention-product-icon">
                            <Package size={18} />
                          </div>

                          <div className="attention-product-copy">
                            <strong>{product.name}</strong>
                            <span>
                              {product.sku} · Reorder at{" "}
                              {product.reorderPoint}
                            </span>
                          </div>

                          <div className="attention-quantity">
                            <strong>{product.quantity}</strong>
                            <span>left</span>
                          </div>
                        </div>
                      ))}

                      {lowStockProducts.length === 0 && dashboard && (
                        <div className="empty-state compact">
                          <CheckCircle2 size={23} />
                          <strong>All stocked up</strong>
                          <span>
                            No products currently need reordering.
                          </span>
                        </div>
                      )}

                      {!dashboard && (
                        <div className="empty-state compact">
                          <Activity size={23} />
                          <strong>Loading stock status</strong>
                          <span>
                            Retrieving data from the database...
                          </span>
                        </div>
                      )}
                    </div>

                    <button
                      className="text-link"
                      type="button"
                      onClick={() => {
                        setStatusFilter("all");
                        setCategoryFilter("all");
                        setSearch("");
                        setPage(1);
                        setActiveView("inventory");
                      }}
                    >
                      Review inventory <ArrowRight size={15} />
                    </button>
                  </article>
                </section>

                <section className="panel recent-panel">
                  <div className="panel-heading recent-heading">
                    <div>
                      <h2>Recent inventory activity</h2>
                      <p>
                        Recorded inventory changes from the database
                      </p>
                    </div>

                    <button
                      className="text-link"
                      type="button"
                      onClick={() => setActiveView("activity")}
                    >
                      View activity <ArrowRight size={15} />
                    </button>
                  </div>

                  <div className="recent-list">
                    {recentActivity.length === 0 && dashboard && (
                      <div className="empty-state compact">
                        <Activity size={23} />
                        <strong>No stock movements yet</strong>
                        <span>
                          Recorded inventory changes will appear here.
                        </span>
                      </div>
                    )}

                    {!dashboard && (
                      <div className="empty-state compact">
                        <Activity size={23} />
                        <strong>Loading activity</strong>
                        <span>
                          Retrieving recorded stock movements...
                        </span>
                      </div>
                    )}

                    {recentActivity.map((movement) => {
                      const positive = movement.quantityDelta > 0;

                      return (
                        <div
                          className="recent-row"
                          key={movement.id}
                        >
                          <div
                            className={`movement-icon ${
                              positive
                                ? "movement-positive"
                                : "movement-negative"
                            }`}
                          >
                            {positive ? (
                              <ArrowUpRight size={18} />
                            ) : (
                              <ArrowDownRight size={18} />
                            )}
                          </div>

                          <div className="movement-copy">
                            <strong>
                              {formatMovementType(
                                movement.movementType,
                              )}
                            </strong>

                            <span>
                              {movement.productName} · {movement.sku}
                            </span>
                          </div>

                          <span
                            className={`movement-quantity ${
                              positive
                                ? "quantity-positive"
                                : "quantity-negative"
                            }`}
                          >
                            {positive ? "+" : ""}
                            {movement.quantityDelta} units
                          </span>

                          <span className="movement-time">
                            {formatTimestamp(movement.createdAt)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}

            {activeView === "inventory" && (
              <section className="panel inventory-panel">
                <div className="inventory-toolbar">
                  <div className="inventory-toolbar-copy">
                    <h2>Product catalog</h2>
                    <p>
                      {isProductsLoading
                        ? "Loading products..."
                        : `${formatNumber(totalProducts)} matching products`}
                    </p>
                  </div>

                  <div className="inventory-filters">
                    <div className="filter-label">
                      <SlidersHorizontal size={16} />
                      <span>Filters</span>
                    </div>

                    <select
                      value={categoryFilter}
                      onChange={(event) => {
                        setCategoryFilter(event.target.value);
                        setPage(1);
                      }}
                      aria-label="Filter by category"
                    >
                      <option value="all">All categories</option>

                      {categoryOptions.map((category) => (
                        <option value={category} key={category}>
                          {category}
                        </option>
                      ))}
                    </select>

                    <select
                      value={statusFilter ?? "all"}
                      onChange={(event) => {
                        setStatusFilter(
                          event.target.value as ProductQuery["status"],
                        );
                        setPage(1);
                      }}
                      aria-label="Filter by stock status"
                    >
                      {statusOptions.map((option) => (
                        <option
                          value={option.value}
                          key={option.value}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {search.trim() !== "" && (
                  <div className="search-result-notice">
                    Search results for{" "}
                    <strong>“{search.trim()}”</strong>

                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        setPage(1);
                      }}
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                <div className="table-wrap">
                  <table className="product-table">
                    <thead>
                      <tr>
                        <th>PRODUCT</th>
                        <th>SKU</th>
                        <th>CATEGORY</th>
                        <th>ON HAND</th>
                        <th>UNIT COST</th>
                        <th>STATUS</th>
                        <th>LOCATION</th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredProducts.map((product) => (
                        <tr key={product.id}>
                          <td>
                            <div className="table-product">
                              <div className="table-product-icon">
                                <Package size={18} />
                              </div>

                              <span className="table-product-name">
                                {product.name}
                              </span>
                            </div>
                          </td>

                          <td>
                            <span className="sku-text">
                              {product.sku}
                            </span>
                          </td>

                          <td>
                            <span className="category-text">
                              {product.category}
                            </span>
                          </td>

                          <td>
                            <span
                              className={`quantity-text ${
                                product.quantity <= product.reorderPoint
                                  ? "quantity-warning"
                                  : ""
                              }`}
                            >
                              {formatNumber(product.quantity)}
                            </span>

                            <span className="reorder-caption">
                              Reorder at {product.reorderPoint}
                            </span>
                          </td>

                          <td className="cost-cell">
                            {formatCurrency(product.unitCost)}
                          </td>

                          <td>
                            <span
                              className={`status-pill ${getStatusClass(
                                product,
                              )}`}
                            >
                              <span className="status-dot" />
                              {getStockStatus(product)}
                            </span>
                          </td>

                          <td className="location-cell">
                            {product.location}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {isProductsLoading && (
                    <div className="empty-state table-empty">
                      <Activity size={26} />
                      <strong>Loading inventory</strong>
                      <span>
                        Retrieving products from PostgreSQL...
                      </span>
                    </div>
                  )}

                  {!isProductsLoading &&
                    !productError &&
                    filteredProducts.length === 0 && (
                      <div className="empty-state table-empty">
                        <Package size={26} />

                        <strong>
                          {totalProducts === 0 &&
                          !search.trim() &&
                          categoryFilter === "all" &&
                          statusFilter === "all"
                            ? "No products yet"
                            : "No matching products"}
                        </strong>

                        <span>
                          {totalProducts === 0 &&
                          !search.trim() &&
                          categoryFilter === "all" &&
                          statusFilter === "all"
                            ? "Add your first product to start managing inventory."
                            : "Try changing your search or filters."}
                        </span>

                        {totalProducts === 0 &&
                        !search.trim() &&
                        categoryFilter === "all" &&
                        statusFilter === "all" ? (
                          <button
                            className="button button-primary"
                            type="button"
                            onClick={openAddProduct}
                          >
                            <Plus size={16} />
                            Add first product
                          </button>
                        ) : (
                          <button
                            className="button button-secondary"
                            type="button"
                            onClick={() => {
                              setSearch("");
                              setStatusFilter("all");
                              setCategoryFilter("all");
                              setPage(1);
                            }}
                          >
                            Clear filters
                          </button>
                        )}
                      </div>
                    )}
                </div>

                <div className="table-footer">
                  <span>
                    Showing {filteredProducts.length} of{" "}
                    {formatNumber(totalProducts)} matching products
                  </span>

                  <div className="table-pagination">
                    <button
                      type="button"
                      className="pagination-button"
                      disabled={page <= 1 || isProductsLoading}
                      onClick={() =>
                        setPage((current) => current - 1)
                      }
                    >
                      Previous
                    </button>

                    <span>
                      Page {page} of {Math.max(totalPages, 1)}
                    </span>

                    <button
                      type="button"
                      className="pagination-button"
                      disabled={
                        page >= totalPages || isProductsLoading
                      }
                      onClick={() =>
                        setPage((current) => current + 1)
                      }
                    >
                      Next
                    </button>
                  </div>

                  <span className="table-footer-note">
                    <span className="demo-dot" />
                    PostgreSQL
                  </span>
                </div>
              </section>
            )}

                        {!["overview", "inventory"].includes(activeView) && (
              <WorkflowPages
                view={activeView as WorkflowPageView}
                onDataChanged={() =>
                  setRefreshKey((current) => current + 1)
                }
              />
            )}

            <footer className="main-footer">
              <span>SupplyDesk · Inventory operations</span>
              <span>React · TypeScript · PostgreSQL</span>
            </footer>
          </main>
        </div>
      </div>

      {isAddOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!isSaving) {
              setIsAddOpen(false);
            }
          }}
          role="presentation"
        >
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-product-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="modal-kicker">
                  INVENTORY MANAGEMENT
                </span>

                <h2 id="add-product-title">Add a product</h2>

                <p>
                  Save the product to your persistent inventory database.
                </p>
              </div>

              <button
                className="icon-button modal-close"
                type="button"
                disabled={isSaving}
                onClick={() => setIsAddOpen(false)}
                aria-label="Close add product form"
              >
                <X size={19} />
              </button>
            </div>

            <form onSubmit={(event) => void handleAddProduct(event)}>
              <div className="form-grid">
                <label className="form-field">
                  <span>Product name</span>

                  <input
                    autoFocus
                    required
                    maxLength={120}
                    value={form.name}
                    onChange={(event) =>
                      updateForm("name", event.target.value)
                    }
                    placeholder="e.g. USB-C docking station"
                  />
                </label>

                <label className="form-field">
                  <span>SKU</span>

                  <input
                    required
                    maxLength={50}
                    value={form.sku}
                    onChange={(event) =>
                      updateForm("sku", event.target.value)
                    }
                    placeholder="e.g. ELC-1200"
                  />
                </label>

                <label className="form-field">
                  <span>Category</span>

                  <select
                    value={form.category}
                    onChange={(event) =>
                      updateForm("category", event.target.value)
                    }
                  >
                    {Array.from(
                      new Set([
                        "Electronics",
                        "Hardware",
                        "Packaging",
                        "Office supplies",
                        "Other",
                        ...categories,
                      ]),
                    ).map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Storage location</span>

                  <input
                    required
                    maxLength={80}
                    value={form.location}
                    onChange={(event) =>
                      updateForm("location", event.target.value)
                    }
                    placeholder="e.g. Warehouse A"
                  />
                </label>

                <label className="form-field">
                  <span>Quantity on hand</span>

                  <input
                    required
                    type="number"
                    min="0"
                    max="2147483647"
                    step="1"
                    value={form.quantity}
                    onChange={(event) =>
                      updateForm("quantity", event.target.value)
                    }
                  />
                </label>

                <label className="form-field">
                  <span>Reorder point</span>

                  <input
                    required
                    type="number"
                    min="0"
                    max="2147483647"
                    step="1"
                    value={form.reorderPoint}
                    onChange={(event) =>
                      updateForm("reorderPoint", event.target.value)
                    }
                  />
                </label>

                <label className="form-field form-field-full">
                  <span>Unit cost (USD)</span>

                  <input
                    required
                    type="number"
                    min="0"
                    max="9999999999.99"
                    step="0.01"
                    value={form.unitCost}
                    onChange={(event) =>
                      updateForm("unitCost", event.target.value)
                    }
                  />
                </label>
              </div>

              {formError && (
                <p className="form-error" role="alert">
                  <AlertTriangle size={16} />
                  {formError}
                </p>
              )}

              <div className="modal-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={isSaving}
                  onClick={() => setIsAddOpen(false)}
                >
                  Cancel
                </button>

                <button
                  className="button button-primary"
                  type="submit"
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <Activity size={16} />
                  ) : (
                    <Plus size={16} />
                  )}

                  {isSaving ? "Saving..." : "Add product"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

export default App;
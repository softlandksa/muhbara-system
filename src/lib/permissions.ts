import type { Role } from "@/types";

// Role hierarchy
export const ROLES = {
  ADMIN: "ADMIN",
  GENERAL_MANAGER: "GENERAL_MANAGER",
  SALES_MANAGER: "SALES_MANAGER",
  SALES: "SALES",
  SUPPORT: "SUPPORT",
  SHIPPING: "SHIPPING",
  FOLLOWUP: "FOLLOWUP",
  HR: "HR",
} as const;

// Arabic role names
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "مدير النظام",
  GENERAL_MANAGER: "مدير عام",
  SALES_MANAGER: "مدير فريق",
  SALES: "موظف مبيعات",
  SUPPORT: "متابعة ودعم",
  SHIPPING: "موظف شحن",
  FOLLOWUP: "موظف متابعة",
  HR: "الموارد البشرية",
};

// Permissions matrix
export const permissions = {
  // Orders
  orders: {
    view: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES", "SUPPORT", "SHIPPING", "FOLLOWUP"] as Role[],
    create: ["ADMIN", "SALES", "SUPPORT"] as Role[],
    edit: ["ADMIN", "SALES", "SUPPORT"] as Role[],
    delete: ["ADMIN"] as Role[],
    import: ["ADMIN", "SALES", "SUPPORT"] as Role[],
    export: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER"] as Role[],
  },
  // Shipping
  shipping: {
    view: ["ADMIN", "SHIPPING"] as Role[],
    ship: ["ADMIN", "SHIPPING"] as Role[],
    updateStatus: ["ADMIN", "SHIPPING"] as Role[],
  },
  // Follow-up
  followup: {
    view: ["ADMIN", "FOLLOWUP"] as Role[],
    addNote: ["ADMIN", "FOLLOWUP"] as Role[],
  },
  // Reports
  reports: {
    sales: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER"] as Role[],
    actualPerformance: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "HR"] as Role[],
    employees: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "HR"] as Role[],
    teamPerformance: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "HR"] as Role[],
    selfReports: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "HR", "SALES", "SUPPORT", "SHIPPING", "FOLLOWUP"] as Role[],
    daily: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES", "SUPPORT", "SHIPPING", "FOLLOWUP", "HR"] as Role[],
    commissions: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "HR"] as Role[],
    shippingReport: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SHIPPING"] as Role[],
    myOrders: ["SALES", "FOLLOWUP"] as Role[],
    targets: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES", "SHIPPING", "FOLLOWUP"] as Role[],
  },
  // Admin
  admin: {
    employeesView: ["ADMIN", "GENERAL_MANAGER"] as Role[],
    employees: ["ADMIN"] as Role[],
    teams: ["ADMIN"] as Role[],
    commissions: ["ADMIN"] as Role[],
    targets: ["ADMIN", "GENERAL_MANAGER"] as Role[],
    settings: ["ADMIN"] as Role[],
    activityLog: ["ADMIN"] as Role[],
  },
  // Notifications
  notifications: {
    view: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES", "SUPPORT", "SHIPPING", "FOLLOWUP", "HR"] as Role[],
  },
};

export function hasPermission(
  userRole: Role,
  resource: keyof typeof permissions,
  action: string
): boolean {
  const resourcePerms = permissions[resource] as Record<string, Role[]>;
  if (!resourcePerms || !resourcePerms[action]) return false;
  return resourcePerms[action].includes(userRole);
}

// Check if user can edit order
export function canEditOrder(
  userRole: Role,
  userId: string,
  orderCreatedById: string,
): boolean {
  if (userRole === "ADMIN") return true;
  if (userRole === "SALES" || userRole === "SUPPORT") return userId === orderCreatedById;
  return false;
}

// Check if user can view order (team-scoped for SALES_MANAGER and SALES)
export function canViewOrder(
  userRole: Role,
  userId: string,
  userTeamId: string | null,
  orderCreatedById: string,
  orderTeamId: string | null
): boolean {
  if (userRole === "ADMIN" || userRole === "GENERAL_MANAGER") return true;
  if (userRole === "SALES_MANAGER") return orderTeamId === userTeamId;
  if (userRole === "SALES" || userRole === "SUPPORT") return orderCreatedById === userId;
  if (userRole === "SHIPPING" || userRole === "FOLLOWUP") return true;
  return false;
}

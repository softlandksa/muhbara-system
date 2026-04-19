import type {
  User,
  Order,
  OrderItem,
  OrderAuditLog,
  ShippingInfo,
  FollowUpNote,
  Country,
  Currency,
  PaymentMethod,
  ShippingCompany,
  ShippingStatusPrimary,
  ShippingStatusSub,
  Product,
  DailyReport,
  CommissionRule,
  Commission,
  UserTarget,
  Notification,
  ActivityLog,
  Team,
  Role,
  CommissionType,
  CommissionStatus,
  NotificationType,
} from "@prisma/client";

export type {
  User,
  Order,
  OrderItem,
  OrderAuditLog,
  ShippingInfo,
  FollowUpNote,
  Country,
  Currency,
  PaymentMethod,
  ShippingCompany,
  ShippingStatusPrimary,
  ShippingStatusSub,
  Product,
  DailyReport,
  CommissionRule,
  Commission,
  UserTarget,
  Notification,
  ActivityLog,
  Team,
  Role,
  CommissionType,
  CommissionStatus,
  NotificationType,
};

// Backward-compat alias
export type ShippingStatus = ShippingStatusPrimary;

// Lightweight status type used in most responses
export type OrderStatusItem = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
};

// Extended types with relations
export type OrderWithDetails = Order & {
  status: OrderStatusItem;
  country: Country;
  currency: Currency;
  paymentMethod: PaymentMethod;
  createdBy: Pick<User, "id" | "name" | "email">;
  team: Team | null;
  items: (OrderItem & { product: Product })[];
  shippingInfo:
    | (ShippingInfo & {
        shippingCompany: ShippingCompany;
        shippedBy: Pick<User, "id" | "name">;
      })
    | null;
  followUpNotes: (FollowUpNote & {
    createdBy: Pick<User, "id" | "name">;
  })[];
};

export type UserWithTeam = User & {
  team: Team | null;
  managedTeams: Team[];
};

export type TeamWithMembers = Team & {
  manager: Pick<User, "id" | "name" | "email">;
  members: Pick<User, "id" | "name" | "email" | "role">[];
};

// Session user type
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamId: string | null;
};

// API Response types
export type ApiResponse<T> = {
  data?: T;
  error?: string;
  message?: string;
};

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// Filter types
export type OrderFilters = {
  statusId?: string;
  countryId?: string;
  currencyId?: string;
  teamId?: string;
  createdById?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
};

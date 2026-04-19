# Performance Improvements

## What Was Slow

### 1. Missing Database Indexes (Critical)
`OrderItem`, `ShippingInfo`, `ShippingStatus`, `Product`, and `CommissionRule` had no indexes at all. Queries joining these tables did full sequential scans.

### 2. N+1 Query Storm — Team Performance Report (High)
`/api/reports/team-performance` ran **6 parallel queries per employee** inside `employees.map(async (emp) => {...})`. With 20 employees = 120 round-trips to the database for a single page load.

### 3. Full Table Scan on /reports/sales (High)
`/api/reports/sales` fetched **all matching orders** with full relation joins (`status`, `country`, `currency`, `paymentMethod`, `createdBy`), then looped through them in JavaScript to build 5 chart datasets. With 10,000 orders this was ~10,000 rows transferred over the wire just to count them.

### 4. No `staleTime` on React Query (Medium)
Dashboard, shipping, and orders queries had `staleTime: 0` (default). Every component remount (navigation, tab switch, Suspense re-trigger) fired a fresh network request even if data was just fetched a second ago.

### 5. Shipping page fetches all orders with no staleTime (Medium)
`/api/shipping` GET returns all orders with full includes and no pagination. Combined with `staleTime: 0`, this was fetched on every visit.

---

## Changes Made

### Database Indexes (`prisma/schema.prisma` + `db push`)

| Model | Indexes Added |
|-------|--------------|
| `OrderItem` | `(orderId)`, `(productId)` |
| `ShippingInfo` | `(shippingCompanyId)`, `(shippedById)`, `(shippedAt)` |
| `ShippingStatus` | `(isActive)`, `(sortOrder)` |
| `Product` | `(isActive)`, `(deletedAt)` |
| `CommissionRule` | `(roleType, currencyId)`, `(isActive)` |

Applied via `prisma db push`.

### Team Performance: N+1 → 4 Batch Queries
**Before:** `6 queries × N employees` (120 queries for 20 employees)  
**After:** 4 `groupBy` queries total, independent of employee count

Replaced per-employee `count`, `count` (delivered), `count` (returned), `count` (cancelled), `aggregate` (revenue), `findFirst` (lastOrder) with:
- `order.groupBy({ by: ['createdById'], _count, _sum, _max })` — total + revenue + lastOrderDate
- 3 `order.groupBy({ by: ['createdById'], where: { statusId: X }, _count })` — delivered / returned / cancelled

### Sales Report: JS Aggregation → SQL GroupBy
**Before:** Fetch all orders with joins → loop in JS to build 5 chart datasets  
**After:** 7 parallel queries run simultaneously:
- `aggregate()` for summary count + revenue
- `findMany` of only `(orderDate, totalAmount)` for daily chart (no joins)
- 4 `groupBy` queries for country/currency/payment/status charts
- `findMany` capped at 100 for the detail table

### React Query `staleTime`

| Page / Query | Before | After |
|---|---|---|
| Dashboard | 0 (default) | 60 000 ms |
| Shipping orders | 0 | 60 000 ms |
| Shipping lookups | 0 | 5 min |
| Orders list | 0 | 30 000 ms |
| Sales report | 0 | 60 000 ms |

All list queries already had `placeholderData: prev => prev` (keepPreviousData) — filter/page changes now feel instant.

---

## Before / After (Estimates)

| Flow | Before | After |
|---|---|---|
| Team report (20 employees) | ~120 DB round-trips | 7 DB round-trips |
| Sales report (10k orders) | 10k rows fetched + JS loop | groupBy in SQL, 100 rows to client |
| Dashboard revisit | Full refetch every navigation | Cached 60s, no network |
| Orders filter change | Full refetch every tab | Cached 30s with placeholder |

---

## Build Status
`tsc --noEmit`: ✅ zero errors  
`prisma db push`: ✅ indexes applied  

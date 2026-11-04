# System Architecture — Grab n Go

## 1. High-Level Architectural Overview

The Grab n Go platform consists of three client applications and a centralized backend API communicating over HTTP/REST and WebSockets:

1. **Student Client (Mobile App):**
   - Built with cross-platform mobile frameworks (React Native or Flutter).
   - Allows IIT Patna students to authenticate using campus credentials, view live crowd congestion indicators per outlet, browse digitized menus (e.g. Arya Services), schedule pickup slots, make digital payments, and track order tokens in real-time.

2. **Vendor KDS (Kitchen Display System):**
   - Optimized for tablets/touchscreen displays located behind food court counters.
   - Incoming tickets are sorted by preparation priority and pickup slot.
   - Instant 1-tap state transitions (`PREPARING` -> `READY_FOR_PICKUP` -> `COMPLETED`).
   - Quick stock toggle to mark finished items unavailable.

3. **Campus Admin Portal:**
   - Web application for food court managers to monitor service levels, average order turnaround times, dispute resolution, and vendor payouts.

4. **Backend Core:**
   - REST API for transactional workflows (Auth, Cart, Checkout, Menu queries).
   - WebSocket / Server-Sent Events (SSE) server for live order status countdowns and instant pickup notifications.
   - Queue Estimation Engine calculating real-time prep and wait estimates.
   - Persistent relational database (PostgreSQL) with Redis for caching queue states.

```
       ┌────────────────────────┐
       │   Student Mobile App   │
       └───────────┬────────────┘
                   │ HTTPS / WSS
                   ▼
┌──────────────────────────────────────────────┐
│          Grab n Go API Gateway               │
│                                              │
│  [Auth] [Menu] [Orders] [Queue] [Payments]   │
└──────────┬───────────────────────────┬───────┘
           │                           │
           ▼                           ▼
┌──────────────────────┐    ┌─────────────────────┐
│  PostgreSQL Database │    │  Redis Queue Cache  │
└──────────────────────┘    └─────────────────────┘
           ▲
           │ HTTPS / WSS
┌──────────┴────────────┐   ┌──────────────────────┐
│  Vendor KDS (Tablets) │   │ Campus Admin Portal  │
└───────────────────────┘   └──────────────────────┘
```

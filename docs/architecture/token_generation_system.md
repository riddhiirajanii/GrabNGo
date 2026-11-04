# Anti-Collision Token Generation System

## 1. Objective
Directly resolve the second major finding from field research:
> *"Sometimes food orders get mixed up. Once an order is placed, students generally have to wait around until it is ready."*

## 2. Token Format
Tokens follow a clean alphanumeric structure that is clearly readable, memorable, and visible from a distance on pickup counters:

$$\text{[Outlet Prefix]} - \text{[Sequential Daily Index]}$$

Examples:
- **Arya Services:** `#A-101`, `#A-102`, `#A-103`...
- **Angeethi Café:** `#ANG-045`, `#ANG-046`...
- **Central Food Court:** `#FC-201`, `#FC-202`...

## 3. Pickup Counter Verification Protocol
1. **Push Alert:** When vendor marks order as `READY_FOR_PICKUP` on their KDS, a high-priority push notification and sound alert is dispatched to the student's phone displaying token `#A-104`.
2. **Display Screen:** Outlet counter TV/tablet displays a 2-column board:
   - **Now Preparing:** `[#A-105, #A-106, #A-107]`
   - **Ready for Pickup:** `[#A-102, #A-103, #A-104]`
3. **Verification:** The student walks to the express pickup counter, shows the token QR code / alphanumeric badge on their app screen, and grabs their packaged meal within 10 seconds without any verbal disputes or queueing.

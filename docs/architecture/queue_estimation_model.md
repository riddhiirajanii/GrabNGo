# Queue Estimation & Congestion Model

## 1. Objective
Solve the core issue discovered in IIT Patna fieldwork:
> *"There is no visibility of the queue length at other outlets before placing an order. Students only discover crowding after reaching the food court."*

## 2. Estimation Algorithm

For an outlet $O$, estimated pickup time $T_{\text{ready}}$ for a new incoming order $i$ is calculated as:

$$T_{\text{ready}} = T_{\text{current}} + T_{\text{base\_prep}} + \sum_{k \in \text{ActiveOrders}} \omega_k \cdot t_k + \Delta_{\text{rush}}$$

Where:
- $T_{\text{base\_prep}}$: Minimum turnaround time for preparing the selected items (from menu metadata, e.g., 5 mins for Maggie/Burger, 15 mins for Tandoor/Curries).
- $\text{ActiveOrders}$: List of orders currently in `PLACED` or `PREPARING` status at the specific outlet.
- $\omega_k$: Item complexity weighting coefficient.
- $\Delta_{\text{rush}}$: Vendor rush-mode offset manually or automatically triggered during peak lunch/evening hours.

## 3. Real-Time Crowd Indicators
Outlets display a live color-coded crowd indicator in the Student App:

| Congestion Level | Active Backlog | Avg Wait Time | UI Badge |
|---|---|---|---|
| **Low** | 0 – 4 orders | < 10 mins | 🟢 Green ("Fast - Grab Quickly") |
| **Moderate** | 5 – 12 orders | 10 – 18 mins | 🟡 Yellow ("Moderate Rush") |
| **High** | 13 – 25 orders | 18 – 30 mins | 🟠 Orange ("Peak Rush - Pre-order Ahead") |
| **Congested** | > 25 orders | 30+ mins | 🔴 Red ("Heavy Queue - Consider Other Outlets") |

This empowers students to compare outlets (e.g. Arya Services vs Angeethi Café) before ordering and distribute demand smoothly across campus.

# LkSystem - Detailed Sequence & Data Flow Diagrams

---

## 🔄 Use Case 1: WooCommerce Order Ingestion Sequence

```mermaid
sequenceDiagram
    actor Customer
    participant WooCommerce as WC Store
    participant Webhook as Backend Webhook
    participant Service as OrderIngestionService
    participant DB as Database
    participant Logger as OrderLog
    
    Customer->>WooCommerce: Place order
    activate WooCommerce
    WooCommerce->>Webhook: POST /api/webhooks/orders/
    deactivate WooCommerce
    
    activate Webhook
    Webhook->>Service: process_order_webhook(wc_order_data)
    deactivate Webhook
    
    activate Service
    Service->>DB: Check Client exists (email)
    DB-->>Service: Not found
    
    Service->>DB: Create new Client<br/>(from WC order)
    DB-->>Service: client_id=123
    
    Service->>DB: Fetch SalesChannel config
    DB-->>Service: channel with WC credentials
    
    Service->>DB: Create Order<br/>(PENDING status)
    DB-->>Service: order_id=456
    
    loop For each WC line item
        Service->>DB: Fetch/Create Product<br/>(from wc_product_id)
        DB-->>Service: product_id=789
        
        Service->>DB: Create OrderLine<br/>(qty, unit_price)
        DB-->>Service: orderline_id
        
        Service->>DB: Get SalesChannelInventory
        DB-->>Service: current qty
        
        Service->>DB: Update inventory<br/>reserved_qty += qty
        DB-->>Service: saved
    end
    
    Service->>Logger: Create OrderLog<br/>(action=CREATED)
    Logger-->>Service: logged
    
    Service->>DB: Mark Order status<br/>PROCESSING
    DB-->>Service: saved
    
    deactivate Service
    
    Note over DB: Order now ready<br/>for fulfillment
```

---

## 📦 Use Case 2: POS Order Creation Sequence

```mermaid
sequenceDiagram
    actor Cashier
    participant POS as POS Terminal
    participant API as /api/v1/orders/
    participant Service as OrderService
    participant Inventory as InventoryService
    participant DB as Database
    
    Cashier->>POS: Scan product barcode
    activate POS
    POS->>API: POST /api/v1/orders/<br/>(source: POS, items: [...])
    deactivate POS
    
    activate API
    API->>Service: create_pos_order(request_data)
    deactivate API
    
    activate Service
    Service->>DB: Get/Create Client<br/>(from POS terminal ID or email)
    DB-->>Service: client_id
    
    Service->>DB: Create Order<br/>(source=POS, status=PENDING)
    DB-->>Service: order_id
    
    loop For each line item
        Service->>Inventory: reserve_stock<br/>(product_id, qty, channel_id)
        activate Inventory
        
        Inventory->>DB: Get SalesChannelInventory
        DB-->>Inventory: current inventory
        
        alt Stock available
            Inventory->>DB: reserved_qty += qty
            DB-->>Inventory: updated
            Inventory-->>Service: OK
        else Out of stock
            Inventory-->>Service: ERROR: insufficient stock
            Service->>DB: Mark OrderLine<br/>is_deleted=true
        end
        deactivate Inventory
        
        Service->>DB: Create OrderLine<br/>(product, qty, price)
    end
    
    Service->>DB: Calculate totals<br/>(sum line_total - discount)
    DB-->>Service: total_amount
    
    Service->>DB: Collect payment<br/>(payment_status=PAID)
    Service->>DB: Mark Order<br/>status=COMPLETED
    
    Service-->>POS: Return order confirmation
    
    activate POS
    POS->>Cashier: Print receipt
    Cashier->>POS: Confirm payment
    deactivate POS
    
    deactivate Service
    
    Note over DB: Order completed,<br/>Inventory reserved
```

---

## 📊 Use Case 3: Multi-Channel Inventory Synchronization

```mermaid
graph LR
    subgraph WC["WooCommerce<br/>(Online Store)"]
        WC_Stock["Stock: 50"]
    end
    
    subgraph API["Backend API"]
        Channel["SalesChannel<br/>(WooCommerce)"]
        Inventory["SalesChannelInventory<br/>Product=Nike Shoes<br/>Channel=WC<br/>Qty=50<br/>Reserved=5<br/>Available=45"]
        Movement["InventoryMovement<br/>(Audit Trail)"]
    end
    
    subgraph Warehouse["Warehouse<br/>(Physical)"]
        WH_Stock["Stock: 100"]
    end
    
    subgraph WH_DB["Warehouse Inventory DB"]
        WH_Inv["SalesChannelInventory<br/>Product=Nike Shoes<br/>Channel=WH001<br/>Qty=100<br/>Reserved=20<br/>Available=80"]
    end
    
    WC -.Sync via Webhook.-> API
    Warehouse -.Manual Upload.-> API
    API --> Movement
    
    Movement -->|type=SALE| Inventory
    Movement -->|type=TRANSFER_OUT| WH_Inv
    
    style Inventory fill:#c2e59c
    style WH_Inv fill:#c2e59c
    style Movement fill:#f9e79f
```

---

## 🔐 Use Case 4: Role-Based Access Control (RBAC) Flow

```mermaid
graph TD
    User["User: john@example.com<br/>current_company=LkCompany<br/>allowed_brands=[Nike, Adidas]"]
    
    subgraph UserRoles["User's Role Assignments"]
        UR1["UserRole<br/>Role=Manager<br/>Scope=Company<br/>company=LkCompany"]
        UR2["UserRole<br/>Role=Supervisor<br/>Scope=Brand<br/>brand=Nike<br/>company=LkCompany"]
        UR3["UserRole<br/>Role=Cashier<br/>Scope=Channel<br/>sales_channel=WH001<br/>company=LkCompany"]
    end
    
    subgraph Roles["Roles & Permissions"]
        R1["Manager Role<br/>✓ manage_products<br/>✓ manage_users<br/>✓ view_reports"]
        R2["Supervisor Role<br/>✓ manage_brand_inventory<br/>✓ create_orders<br/>✗ manage_users"]
        R3["Cashier Role<br/>✓ use_pos<br/>✓ view_orders<br/>✗ manage_inventory"]
    end
    
    subgraph Permissions["App Permissions"]
        P1["manage_products<br/>(category: products)"]
        P2["manage_users<br/>(category: users)"]
        P3["use_pos<br/>(category: orders)"]
    end
    
    subgraph Result["Access Decision"]
        Query["Check: Can user use_pos<br/>at sales_channel=WH001?"]
        Decision["✓ YES<br/>(Has Cashier role<br/>at WH001)"]
    end
    
    User --> UR1
    User --> UR2
    User --> UR3
    
    UR1 --> R1
    UR2 --> R2
    UR3 --> R3
    
    R1 --> P1
    R1 --> P2
    R2 --> P3
    R3 --> P3
    
    P3 --> Query
    UR3 --> Query
    Query --> Decision
    
    style User fill:#ff9999
    style Decision fill:#99ff99
```

---

## 🎯 Use Case 5: Order Status & Delivery Lifecycle

```mermaid
stateDiagram-v2
    [*] --> PENDING: Order Created
    
    PENDING --> PROCESSING: Start processing
    PENDING --> CANCELLED: Cancel order
    
    PROCESSING --> ON_HOLD: Hold for review
    PROCESSING --> COMPLETED: Fulfill order
    PROCESSING --> CANCELLED: Cancel order
    PROCESSING --> REFUNDED: Customer requests refund
    
    ON_HOLD --> PROCESSING: Resume
    ON_HOLD --> CANCELLED: Cancel order
    
    COMPLETED --> REFUNDED: Process refund
    COMPLETED --> FAILED: Delivery failed
    
    CANCELLED --> [*]
    REFUNDED --> [*]
    FAILED --> [*]
    
    note right of PENDING
        Awaiting fulfillment
        Delivery Status: NONE or PENDING
    end note
    
    note right of PROCESSING
        Being prepared
        Inventory reserved
        Delivery Status: QUEUED → SUBMITTED
    end note
    
    note right of COMPLETED
        Order fulfilled
        Delivery Status: DELIVERED
    end note
    
    note right of REFUNDED
        Money returned
        Order closed
    end note
```

---

## 📦 Delivery Status Independent Lifecycle

```mermaid
stateDiagram-v2
    [*] --> NONE: Not applicable<br/>(local pickup)
    [*] --> PENDING: Order placed
    
    NONE --> [*]
    
    PENDING --> QUEUED: Prepared for shipment
    QUEUED --> SUBMITTED: Handed to courier
    SUBMITTED --> ACCEPTED: Courier confirmed
    ACCEPTED --> IN_TRANSIT: On the way
    IN_TRANSIT --> DELIVERED: Customer received
    IN_TRANSIT --> FAILED: Delivery failed
    IN_TRANSIT --> RETURNED: Customer rejected
    
    FAILED --> QUEUED: Retry
    QUEUED --> CANCELLED: Cancelled
    SUBMITTED --> CANCELLED: Cancelled
    PENDING --> CANCELLED: Cancelled
    
    DELIVERED --> [*]: Complete
    RETURNED --> [*]: Returned
    CANCELLED --> [*]: Cancelled
    
    note right of PENDING
        Waiting to be packed
    end note
    
    note right of QUEUED
        Ready for pickup
    end note
    
    note right of SUBMITTED
        With delivery partner
    end note
    
    note right of IN_TRANSIT
        GPS tracking available
    end note
    
    note right of DELIVERED
        ✓ Successfully delivered
    end note
```

---

## 💰 Use Case 6: Channel-Specific Promotion Calculation

```mermaid
graph TD
    A["Product: Nike Air Max<br/>Purchase: 30 TND<br/>Base Sale: 89 TND"] -->|Fetch| B["Promotion<br/>name: Summer20<br/>discount_type: PERCENTAGE<br/>discount_value: 20%"]
    
    B -->|Find Rule for| C["Sales Channel"]
    
    C -->|WooCommerce| D["PromotionChannelRule<br/>Discount Override: 25%<br/>Final: 89 × 0.75 = 66.75 TND"]
    
    C -->|Retail Store| E["PromotionChannelRule<br/>Discount Override: 20% (default)<br/>Final: 89 × 0.80 = 71.20 TND"]
    
    C -->|Warehouse| F["No Rule<br/>No Discount<br/>Final: 89.00 TND"]
    
    D --> G["Order Created<br/>Channel=WooCommerce<br/>Unit Price: 66.75"]
    E --> H["Order Created<br/>Channel=Retail<br/>Unit Price: 71.20"]
    F --> I["Order Created<br/>Channel=Warehouse<br/>Unit Price: 89.00"]
    
    style A fill:#fff9e6
    style B fill:#ffe6e6
    style D fill:#e6f3ff
    style E fill:#e6f3ff
    style F fill:#e6f3ff
    style G fill:#c2e59c
    style H fill:#c2e59c
    style I fill:#c2e59c
```

---

## 🔍 Use Case 7: Data Flow - Complete Order Processing

```mermaid
graph LR
    subgraph Input["Input"]
        WC["WooCommerce<br/>Order Webhook"]
        POS["POS<br/>Terminal"]
        Manual["Manual<br/>Entry"]
    end
    
    subgraph Processing["Processing Layer"]
        Ingest["OrderIngestionService<br/>1. Validate data<br/>2. Create/Update client<br/>3. Create order<br/>4. Create orderlines<br/>5. Reserve inventory"]
        
        Inv["InventoryService<br/>1. Get current qty<br/>2. Check available<br/>3. Reserve qty<br/>4. Create movement"]
    end
    
    subgraph Database["Data Persistence"]
        Order["Order<br/>order_number<br/>status<br/>total_amount"]
        OLine["OrderLine<br/>product_id<br/>qty<br/>unit_price"]
        Client["Client<br/>email<br/>phone<br/>address"]
        Inventory["SalesChannelInventory<br/>quantity<br/>reserved_qty"]
        Movement["InventoryMovement<br/>reference_num<br/>type<br/>quantity"]
        Log["OrderLog<br/>action<br/>actor<br/>timestamp"]
    end
    
    subgraph Output["Output"]
        API["REST API<br/>Order created"]
        UI["Frontend<br/>Dashboard update"]
        Webhook_Out["Webhook<br/>Notify 3rd party"]
    end
    
    WC --> Ingest
    POS --> Ingest
    Manual --> Ingest
    
    Ingest --> Inv
    
    Inv --> Inventory
    Ingest --> Order
    Ingest --> OLine
    Ingest --> Client
    Inv --> Movement
    Ingest --> Log
    
    Order --> API
    OLine --> API
    Order --> UI
    Order --> Webhook_Out
    
    style Processing fill:#e6f3ff
    style Database fill:#f0f0f0
```

---

## 🏢 Multi-Tenancy Architecture

```mermaid
graph TD
    subgraph T1["Tenant 1: LkCompany"]
        C1["Company<br/>id=1<br/>name=Lk System<br/>abbreviation=LK"]
        
        subgraph B1["Brand: Nike"]
            CH1["SalesChannel: WH001<br/>(Warehouse)"]
            CH2["SalesChannel: WC<br/>(WooCommerce)"]
            CH3["SalesChannel: Retail"]
        end
        
        subgraph B2["Brand: Adidas"]
            CH4["SalesChannel: WH002<br/>(Warehouse)"]
        end
        
        U1["User: john<br/>current_company=LK<br/>allowed_brands=[Nike, Adidas]"]
        
        C1 --> B1
        C1 --> B2
        C1 --> U1
    end
    
    subgraph T2["Tenant 2: AnotherCo"]
        C2["Company<br/>id=2<br/>name=Another Company<br/>abbreviation=AC"]
        
        subgraph B3["Brand: Puma"]
            CH5["SalesChannel: WH003"]
        end
        
        U2["User: alice<br/>current_company=AC<br/>allowed_brands=[Puma]"]
        
        C2 --> B3
        C2 --> U2
    end
    
    DB["Single Database<br/>company_id filters<br/>isolate tenants"]
    
    T1 -.filter by company_id=1.-> DB
    T2 -.filter by company_id=2.-> DB
    
    U1 -.cannot access T2.-> T2
    U2 -.cannot access T1.-> T1
    
    style T1 fill:#c2e59c
    style T2 fill:#c2e59c
    style DB fill:#ffcccc
```

---

## 🔗 Complete Entity Relationship Map

```mermaid
graph TB
    Company["Company<br/>├─ name<br/>├─ abbreviation<br/>└─ matrix_fiscale"]
    
    User["User<br/>├─ matricule<br/>├─ email<br/>├─ current_company FK<br/>└─ allowed_brands M2M"]
    
    Brand["Brand<br/>├─ name<br/>├─ company FK<br/>└─ logo"]
    
    SalesChannel["SalesChannel<br/>├─ name<br/>├─ code<br/>├─ channel_type<br/>├─ brand FK<br/>└─ wc_store_url"]
    
    Product["Product<br/>├─ name<br/>├─ barcode<br/>├─ wc_product_id<br/>├─ purchase_price<br/>├─ sales_price<br/>└─ is_deleted"]
    
    Category["Category<br/>├─ name<br/>├─ wc_category_id<br/>├─ sales_channel FK<br/>└─ parent FK (self)"]
    
    Client["Client<br/>├─ email<br/>├─ phone<br/>├─ company FK<br/>├─ brand FK<br/>└─ wc_customer_id"]
    
    Order["Order<br/>├─ order_number<br/>├─ status<br/>├─ source<br/>├─ total_amount<br/>├─ client FK<br/>├─ sales_channel FK<br/>└─ delivery_status"]
    
    OrderLine["OrderLine<br/>├─ order FK<br/>├─ product FK<br/>├─ quantity<br/>└─ unit_price"]
    
    Inventory["SalesChannelInventory<br/>├─ product FK<br/>├─ sales_channel FK<br/>├─ quantity<br/>├─ reserved_qty<br/>└─ bin_location"]
    
    Movement["InventoryMovement<br/>├─ product FK<br/>├─ sales_channel FK<br/>├─ movement_type<br/>└─ quantity"]
    
    Promotion["Promotion<br/>├─ name<br/>├─ code<br/>├─ product FK<br/>├─ brand FK<br/>├─ discount_type<br/>└─ status"]
    
    PromRule["PromotionChannelRule<br/>├─ promotion FK<br/>├─ sales_channel FK<br/>└─ discount_percentage"]
    
    Permission["AppPermission<br/>├─ codename<br/>├─ name<br/>├─ category<br/>└─ description"]
    
    Role["Role<br/>├─ name<br/>├─ scope_type<br/>├─ company FK<br/>├─ permissions M2M<br/>└─ is_system"]
    
    UserRole["UserRole<br/>├─ user FK<br/>├─ role FK<br/>├─ company FK<br/>├─ brand FK<br/>└─ sales_channel FK"]
    
    OrderLog["OrderLog<br/>├─ order FK<br/>├─ action<br/>├─ actor FK<br/>└─ timestamp"]
    
    OrderSync["OrderSyncEvent<br/>├─ sales_channel FK<br/>├─ sync_start<br/>├─ sync_end<br/>└─ orders_synced"]
    
    Company -->|has| Brand
    Company -->|has| User
    Company -->|has| Client
    Company -->|has| Role
    
    Brand -->|has| Product
    Brand -->|has| SalesChannel
    Brand -->|has| Promotion
    Brand -->|has| Client
    
    SalesChannel -->|has| Inventory
    SalesChannel -->|has| Order
    SalesChannel -->|has| Movement
    SalesChannel -->|has| OrderSync
    SalesChannel -->|has| Category
    
    Product -->|in| Inventory
    Product -->|in| OrderLine
    Product -->|in| Movement
    Product -->|in| Promotion
    
    User -->|belongs| Company
    User -->|access| Brand
    User -->|has| UserRole
    User -->|creates| OrderLog
    
    Order -->|has| OrderLine
    Order -->|has| OrderLog
    Order -->|for| Client
    
    OrderLine -->|of| Product
    
    Promotion -->|has| PromRule
    PromRule -->|for| SalesChannel
    
    Role -->|has| Permission
    Role -->|assigned by| UserRole
    
    Category -->|parent| Category
    Category -->|in| SalesChannel
    
    style Company fill:#ff9999
    style Brand fill:#ffcc99
    style SalesChannel fill:#ffff99
    style Product fill:#ccff99
    style Order fill:#99ff99
    style Inventory fill:#99ffcc
    style User fill:#99ccff
    style Role fill:#cc99ff
```

---

## 💡 Advanced: Soft Delete Pattern

```mermaid
graph LR
    A["Normal Query<br/>Product.objects.all()"] -->|Uses ActiveProductManager| B["Filters is_deleted=False<br/>(Automatic)"]
    B --> C["Only active products<br/>returned"]
    
    D["Include Deleted<br/>Product.all_objects.all()"] -->|Bypasses soft delete| E["Returns ALL products<br/>including deleted"]
    
    D2["Hard Delete Prevention<br/>(Override delete method)"] -->|Calls| F["product.is_deleted=True<br/>product.save()"]
    F --> G["Data preserved<br/>(no physical deletion)"]
    
    style A fill:#e6f3ff
    style D fill:#e6f3ff
    style B fill:#c2e59c
    style C fill:#c2e59c
    style E fill:#ffcccc
    style G fill:#c2e59c
```

---

## 🎬 Permissions Cascade Example

```javascript
// User: john
// Assigned at COMPANY level with Manager role
// Manager has: [manage_products, manage_users, view_reports]

Permissions cascade:
├─ PLATFORM    → No (not assigned)
├─ COMPANY     → YES (Manager role at LkCompany)
│  ├─ BRAND    → YES (via cascade)
│  │  ├─ Nike     → can manage_products ✓
│  │  └─ Adidas   → can manage_products ✓
│  └─ CHANNEL  → YES (via cascade)
│     ├─ WH001    → can manage_products ✓
│     └─ WH002    → can manage_products ✓
└─ User Dashboard → Shows all brands + all channels
                     (Cascade downward)

// Later, assign BRAND-level Supervisor role (Inventory only)
User has:
├─ Company-level Manager  (all permissions)
└─ Brand-level Supervisor (brand-specific only)

Result: User can:
├─ manage_products (from Manager role)
├─ manage_users (from Manager role)
├─ manage_brand_inventory (from Supervisor role)
├─ At Nike brand: all above
└─ At other brands: only manage_products, manage_users
```


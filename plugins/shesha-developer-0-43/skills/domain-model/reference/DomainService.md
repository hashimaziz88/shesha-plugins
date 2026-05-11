# Domain Service Guidelines

The domain services are the core of your application. They are responsible for managing the business logic and data access for your application. The domain services are built on top of the domain model and provide a set of APIs that can be used by the application layer to interact with the domain model.

- Domain Services MUST be implemented by inheriting from the `DomainService` class to get access to useful properties and methods. 
- Each DomainService should implement an interface defining all the Domain Services' public methods
- The naming convention for domain services should be `{entity name}Manager`
- The Domain Service should be placed in the same folder and namespace as its corresponding entity 
- Do not create Domain Service methods that only perform a simple 'pass-through' to the entity's repository 

<example>

``` csharp
using Abp.Domain.Repositories;
using Abp.Domain.Services;
using System;
using System.Threading.Tasks;

namespace MyApp.Domain.Orders
{
    public class OrderManager : DomainService, IOrderManager
    {
        private readonly IRepository<Order, Guid> _orderRepo;
        private readonly IRepository<OrderLineItem, Guid> _orderLineItemRepo;

        public OrderManager(
            IRepository<Order, Guid> orderRepo,
            IRepository<OrderLineItem, Guid> orderLineItemRepo)
        {
            _orderLineItemRepo = orderLineItemRepo;
            _orderRepo = orderRepo;
        }

        ... 

        public async Task<OrderLineItem> UpdateOrderLineItemAsync(OrderLineItem lineItem, int newQuantity)
        {
            var oldQuantity = lineItem.Quantity;
            if (newQuantity <= 0 || newQuantity == oldQuantity)
                throw new ArgumentOutOfRangeException("The new quantity must be greater than zero and different from the current quantity.");

            // Update the line item and the order totals
            lineItem.TotalAmount += lineItem.UnitPrice * newQuantity;
            lineItem.Quantity = newQuantity;
            lineItem.Order.Total += (newQuantity - oldQuantity) * lineItem.UnitPrice;

            return await _orderLineItemRepo.UpdateAsync(lineItem);
        }

        ...

    }
}
```
</example>
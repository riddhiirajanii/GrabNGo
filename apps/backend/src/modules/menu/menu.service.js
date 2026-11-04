const prisma = require('../../database/prisma');

class MenuService {
  async getMenuByOutletId(outletId) {
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    if (!outlet) return null;
    const categories = await prisma.menuCategory.findMany({
      where: { outletId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { items: { orderBy: { name: 'asc' }, include: { variants: { orderBy: { price: 'asc' } } } } }
    });
    const mapped = categories.map(category => ({
      id: category.id,
      name: category.name,
      items: category.items.map(item => ({
        ...(item.metadata && typeof item.metadata === 'object' ? item.metadata : {}),
        id: item.id,
        outletId: item.outletId,
        categoryId: item.categoryId,
        name: item.name,
        description: item.description || '',
        price: item.price,
        is_veg: item.isVeg,
        isAvailable: item.isAvailable,
        variants: item.variants.map(variant => ({ id: variant.id, label: variant.label, price: variant.price }))
      }))
    }));
    const totalItems = mapped.reduce((count, category) => count + category.items.length, 0);
    const outOfStockCount = mapped.reduce((count, category) => count + category.items.filter(item => !item.isAvailable).length, 0);
    return {
      outlet: {
        id: outlet.id, name: outlet.name, campus: outlet.campus, location: outlet.location,
        contacts: outlet.contacts, free_delivery: outlet.freeDelivery, rating: outlet.rating,
        average_prep_time_minutes: outlet.basePrepTime, is_accepting_orders: outlet.isAcceptingOrders
      },
      categories: mapped,
      totalItems,
      outOfStockCount
    };
  }

  async toggleItemAvailability(outletId, itemName, isAvailable) {
    const item = await prisma.menuItem.findFirst({ where: { outletId, name: itemName } });
    if (!item) throw new Error('Item does not belong to this outlet menu');
    const updated = await prisma.menuItem.update({
      where: { id: item.id },
      data: { isAvailable: Boolean(isAvailable) }
    });
    const unavailable = await prisma.menuItem.findMany({
      where: { outletId, isAvailable: false }, select: { name: true }, orderBy: { name: 'asc' }
    });
    return { outletId, itemName, isAvailable: updated.isAvailable, outOfStockList: unavailable.map(row => row.name) };
  }
}
module.exports = new MenuService();

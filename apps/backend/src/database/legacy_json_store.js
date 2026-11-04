/**
 * Grab n Go data store.
 * JSON-backed persistence keeps the prototype state across restarts. Replace this
 * repository with PostgreSQL/Prisma before multi-instance production deployment.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const DATA_DIR = process.env.GNG_DATA_DIR || path.resolve(__dirname, '../../../../.data');
const DB_FILE = path.join(DATA_DIR, 'grabngo.json');

class DataStore {
  constructor() {
    this.outlets = [
      { id:'outlet-arya-services-01', name:'Arya Services', subtitle:'North Indian, Tandoor, Chinese & Traditional Sweets', campus:'IIT Patna', location:'Food Court', tokenPrefix:'A', contacts:['9835493001','9572544000'], rating:4.4, reviewCount:1240, basePrepTime:14, isAcceptingOrders:true, freeDelivery:true, icon:'🍛', accentColor:'#10b981', tags:['Bestseller','Tandoor Special','Express Pickup'] },
      { id:'outlet-discovery-foods', name:'Discovery Foods', subtitle:'Dum Biryanis, Kati Rolls, Shakes & Chai', campus:'IIT Patna', location:'Food Court', tokenPrefix:'ANG', contacts:[], rating:4.5, reviewCount:890, basePrepTime:18, isAcceptingOrders:true, freeDelivery:false, icon:'🥘', accentColor:'#f97316', tags:['Dum Biryani','Kati Rolls','Quick Snacks'] }
    ];
    this.menus = {};
    this.orders = [];
    this.outOfStockItems = new Set();
    this.outletSurgeMinutes = {};
    this.tokenCounters = {};
    this.subscriptions = new Map();
    this.feedback = [];
    this.loadMenu();
    this.load();
  }
  loadMenu() {
    try {
      const raw = fs.readFileSync(config.SEEDS_PATH, 'utf8');
      this.populateMenu('outlet-arya-services-01', JSON.parse(raw));
    } catch (e) { console.error('[Store] Menu seed unavailable:', e.message); }
  }
  populateMenu(outletId, seed) {
    const categories = (seed.categories || []).map(cat => ({...cat, items:(cat.items||[]).map((item,index)=>({...item,id:item.id||`${cat.id}-${index}`,categoryId:cat.id,outletId}))}));
    const itemsById = {};
    categories.forEach(cat => cat.items.forEach(item => { itemsById[item.id]=item; }));
    this.menus[outletId] = { outlet: seed.outlet || this.getOutletById(outletId), categories, itemsById };
  }
  load() {
    try {
      if (!fs.existsSync(DB_FILE)) return;
      const saved = JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
      this.orders = saved.orders || [];
      this.tokenCounters = saved.tokenCounters || {};
      this.outOfStockItems = new Set(saved.outOfStockItems || []);
      this.outletSurgeMinutes = saved.outletSurgeMinutes || {};
      this.subscriptions = new Map(saved.subscriptions || []);
      this.feedback = saved.feedback || [];
    } catch(e) { console.error('[Store] Could not load persistent data:',e.message); }
  }
  persist() {
    fs.mkdirSync(DATA_DIR,{recursive:true});
    const temp = `${DB_FILE}.tmp`;
    fs.writeFileSync(temp,JSON.stringify({orders:this.orders,tokenCounters:this.tokenCounters,outOfStockItems:[...this.outOfStockItems],outletSurgeMinutes:this.outletSurgeMinutes,subscriptions:[...this.subscriptions],feedback:this.feedback},null,2));
    fs.renameSync(temp,DB_FILE);
  }
  getOutlets(){return this.outlets;}
  getOutletById(id){return this.outlets.find(o=>o.id===id)||null;}
  getMenuByOutletId(id){return this.menus[id]||null;}
  stockKey(outletId,name){return `${outletId}::${name}`;}
  toggleStockItem(outletId,name,available){const key=this.stockKey(outletId,name);if(available)this.outOfStockItems.delete(key);else this.outOfStockItems.add(key);this.persist();return !this.outOfStockItems.has(key);}
  isItemInStock(outletId,name){return !this.outOfStockItems.has(this.stockKey(outletId,name));}
  getOutOfStockList(outletId){const prefix=`${outletId}::`;return [...this.outOfStockItems].filter(key=>key.startsWith(prefix)).map(key=>key.slice(prefix.length));}
  setOutletSurge(id,minutes){this.outletSurgeMinutes[id]=Math.max(0,parseInt(minutes,10)||0);this.persist();return this.outletSurgeMinutes[id];}
  getOutletSurge(id){return this.outletSurgeMinutes[id]||0;}
  generateNextToken(id){const outlet=this.getOutletById(id);if(!outlet)throw new Error('Outlet not found');const n=(this.tokenCounters[id]||100)+1;this.tokenCounters[id]=n;this.persist();return `${outlet.tokenPrefix}-${n}`;}
  getOrders(filters={}){return this.orders.filter(o=>(!filters.outletId||o.outletId===filters.outletId)&&(!filters.status||o.status===filters.status)&&(!filters.studentRoll||o.studentRoll===filters.studentRoll));}
  getActiveOrdersByOutlet(id){return this.orders.filter(o=>o.outletId===id&&['PLACED','CONFIRMED','PREPARING','READY_FOR_PICKUP'].includes(o.status));}
  getOrderById(id){return this.orders.find(o=>o.id===id)||null;}
  getOrderByToken(token){return this.orders.find(o=>o.token===token)||null;}
  createOrder(order){this.orders.unshift(order);this.persist();return order;}
  updateOrderStatus(id,status){const o=this.getOrderById(id);if(!o)return null;o.status=status;o.updatedAt=new Date().toISOString();if(status==='READY_FOR_PICKUP')o.readyAt=o.updatedAt;if(status==='COMPLETED')o.completedAt=o.updatedAt;this.persist();return o;}
  hasActivePass(roll){const s=this.subscriptions.get(roll);return !!s&&new Date(s.activeUntil)>new Date()&&s.status==='ACTIVE';}
  activatePass(roll,plan='CAMPUS_PASS_PRO'){const activeUntil=new Date(Date.now()+30*86400000).toISOString();const sub={studentRoll:roll,plan,activeUntil,status:'ACTIVE',createdAt:new Date().toISOString()};this.subscriptions.set(roll,sub);this.persist();return sub;}
  getPass(roll){return this.subscriptions.get(roll)||null;}
  addFeedback(entry){this.feedback.unshift(entry);this.persist();return entry;}
}
module.exports=new DataStore();

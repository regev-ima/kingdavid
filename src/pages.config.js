/* eslint-disable -- auto-generated */
/**
 * pages.config.js - Page routing configuration
 *
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import BulkUpdate from './pages/BulkUpdate';
import CallAnalytics from './pages/CallAnalytics';
import ClubSignups from './pages/ClubSignups';
import CustomerDetails from './pages/CustomerDetails';
import Customers from './pages/Customers';
import Dashboard from './pages/Dashboard';
import Deliveries from './pages/Deliveries';
import EditQuote from './pages/EditQuote';
import ExtraCharges from './pages/ExtraCharges';
import Factory from './pages/Factory';
import FactoryDashboard from './pages/FactoryDashboard';
import Finance from './pages/Finance';
import Inventory from './pages/Inventory';
import LandingPages from './pages/LandingPages';
import LeadDetails from './pages/LeadDetails';
import Leads from './pages/Leads';
import Marketing from './pages/Marketing';
import NewLead from './pages/NewLead';
import NewOrder from './pages/NewOrder';
import NewQuote from './pages/NewQuote';
import NewReturn from './pages/NewReturn';
import NewTicket from './pages/NewTicket';
import NotificationSettings from './pages/NotificationSettings';
import OperationalReports from './pages/OperationalReports';
import OrderDetails from './pages/OrderDetails';
import Orders from './pages/Orders';
import ProductsNew from './pages/ProductsNew';
import QuoteDetails from './pages/QuoteDetails';
import Quotes from './pages/Quotes';
import Representatives from './pages/Representatives';
import ReturnDetails from './pages/ReturnDetails';
import Returns from './pages/Returns';
import SalesDashboard from './pages/SalesDashboard';
import SalesTasks from './pages/SalesTasks';
import Settings from './pages/Settings';
import ShipmentDetails from './pages/ShipmentDetails';
import Support from './pages/Support';
import TicketDetails from './pages/TicketDetails';
import __Layout from './Layout.jsx';


export const PAGES = {
    "BulkUpdate": BulkUpdate,
    "CallAnalytics": CallAnalytics,
    "ClubSignups": ClubSignups,
    "CustomerDetails": CustomerDetails,
    "Customers": Customers,
    "Dashboard": Dashboard,
    "Deliveries": Deliveries,
    "EditQuote": EditQuote,
    "ExtraCharges": ExtraCharges,
    "Factory": Factory,
    "FactoryDashboard": FactoryDashboard,
    "Finance": Finance,
    "Inventory": Inventory,
    "LandingPages": LandingPages,
    "LeadDetails": LeadDetails,
    "Leads": Leads,
    "Marketing": Marketing,
    "NewLead": NewLead,
    "NewOrder": NewOrder,
    "NewQuote": NewQuote,
    "NewReturn": NewReturn,
    "NewTicket": NewTicket,
    "NotificationSettings": NotificationSettings,
    "OperationalReports": OperationalReports,
    "OrderDetails": OrderDetails,
    "Orders": Orders,
    "ProductsNew": ProductsNew,
    "QuoteDetails": QuoteDetails,
    "Quotes": Quotes,
    "Representatives": Representatives,
    "ReturnDetails": ReturnDetails,
    "Returns": Returns,
    "SalesDashboard": SalesDashboard,
    "SalesTasks": SalesTasks,
    "Settings": Settings,
    "ShipmentDetails": ShipmentDetails,
    "Support": Support,
    "TicketDetails": TicketDetails,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
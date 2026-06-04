export interface User {
  person_id: number;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
}

export interface Item {
  item_id: number;
  name: string;
  category: string;
  cost_price: number;
  unit_price: number;
  quantity: number;
  description: string;
}

export interface Sale {
  sale_id: number;
  sale_time: string;
  customer_name: string;
  employee_name: string;
  total: number;
  payment_type: string;
  items_count: number;
}

export interface Customer {
  person_id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  total_spent: number;
  last_visit: string;
}

export interface DashboardStats {
  today_sales: number;
  today_revenue: number;
  today_items_sold: number;
  total_customers: number;
  top_items: { name: string; quantity: number }[];
  recent_sales: Sale[];
  revenue_trend: { date: string; revenue: number }[];
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

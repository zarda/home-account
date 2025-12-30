import { TransactionType } from './transaction.model';

export type CategoryType = 'income' | 'expense' | 'both';

export interface Category {
  id: string;
  userId: string | null;         // null = system default
  name: string;
  icon: string;                  // Material icon name
  color: string;                 // Hex color
  type: CategoryType;
  parentId?: string;             // For subcategories
  order: number;                 // Display order
  isActive: boolean;
  isDefault: boolean;            // System-provided category
}

export interface CategoryGroup {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: TransactionType;
  categories: CategoryItem[];
}

export interface CategoryItem {
  name: string;
  icon: string;
}

export interface CreateCategoryDTO {
  name: string;
  icon: string;
  color: string;
  type: CategoryType;
  parentId?: string;
}

// Default Expense Category Groups
export const DEFAULT_EXPENSE_GROUPS: CategoryGroup[] = [
  {
    id: 'food',
    name: 'Food & Drinks',
    icon: 'restaurant',
    color: '#FF5722',
    type: 'expense',
    categories: [
      { name: 'Restaurants', icon: 'restaurant' },
      { name: 'Groceries', icon: 'shopping_cart' },
      { name: 'Coffee & Drinks', icon: 'local_cafe' },
      { name: 'Fast Food', icon: 'fastfood' },
      { name: 'Delivery', icon: 'delivery_dining' },
    ]
  },
  {
    id: 'transport',
    name: 'Transportation',
    icon: 'directions_car',
    color: '#2196F3',
    type: 'expense',
    categories: [
      { name: 'Fuel & Gas', icon: 'local_gas_station' },
      { name: 'Parking', icon: 'local_parking' },
      { name: 'Public Transit', icon: 'directions_bus' },
      { name: 'Taxi & Ride Share', icon: 'local_taxi' },
      { name: 'Car Maintenance', icon: 'car_repair' },
      { name: 'Car Insurance', icon: 'verified_user' },
    ]
  },
  {
    id: 'shopping',
    name: 'Shopping',
    icon: 'shopping_bag',
    color: '#9C27B0',
    type: 'expense',
    categories: [
      { name: 'Clothing & Fashion', icon: 'checkroom' },
      { name: 'Electronics', icon: 'devices' },
      { name: 'Home & Garden', icon: 'home' },
      { name: 'Furniture', icon: 'chair' },
      { name: 'Online Shopping', icon: 'local_shipping' },
    ]
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    icon: 'movie',
    color: '#E91E63',
    type: 'expense',
    categories: [
      { name: 'Movies & Shows', icon: 'theaters' },
      { name: 'Games & Hobbies', icon: 'sports_esports' },
      { name: 'Music & Concerts', icon: 'headphones' },
      { name: 'Books & Magazines', icon: 'menu_book' },
      { name: 'Bars & Nightlife', icon: 'nightlife' },
    ]
  },
  {
    id: 'bills',
    name: 'Bills & Utilities',
    icon: 'receipt',
    color: '#607D8B',
    type: 'expense',
    categories: [
      { name: 'Electricity', icon: 'bolt' },
      { name: 'Water', icon: 'water_drop' },
      { name: 'Internet & Phone', icon: 'wifi' },
      { name: 'Rent & Mortgage', icon: 'apartment' },
      { name: 'Gas & Heating', icon: 'local_fire_department' },
    ]
  },
  {
    id: 'health',
    name: 'Health & Wellness',
    icon: 'local_hospital',
    color: '#4CAF50',
    type: 'expense',
    categories: [
      { name: 'Doctor & Clinic', icon: 'medical_services' },
      { name: 'Pharmacy & Medicine', icon: 'medication' },
      { name: 'Gym & Fitness', icon: 'fitness_center' },
      { name: 'Sports', icon: 'sports_soccer' },
      { name: 'Mental Health', icon: 'psychology' },
    ]
  },
  {
    id: 'personal',
    name: 'Personal Care',
    icon: 'spa',
    color: '#FF9800',
    type: 'expense',
    categories: [
      { name: 'Hair & Beauty', icon: 'face' },
      { name: 'Cosmetics', icon: 'brush' },
      { name: 'Spa & Massage', icon: 'spa' },
      { name: 'Laundry & Cleaning', icon: 'local_laundry_service' },
    ]
  },
  {
    id: 'education',
    name: 'Education',
    icon: 'school',
    color: '#3F51B5',
    type: 'expense',
    categories: [
      { name: 'Tuition Fees', icon: 'account_balance' },
      { name: 'Courses & Training', icon: 'library_books' },
      { name: 'Books & Supplies', icon: 'auto_stories' },
      { name: 'Online Learning', icon: 'computer' },
    ]
  },
  {
    id: 'travel',
    name: 'Travel & Vacation',
    icon: 'flight',
    color: '#00BCD4',
    type: 'expense',
    categories: [
      { name: 'Flights', icon: 'flight' },
      { name: 'Hotels & Accommodation', icon: 'hotel' },
      { name: 'Vacation Activities', icon: 'beach_access' },
      { name: 'Travel Insurance', icon: 'health_and_safety' },
    ]
  },
  {
    id: 'family',
    name: 'Family & Kids',
    icon: 'child_care',
    color: '#FF80AB',
    type: 'expense',
    categories: [
      { name: 'Childcare', icon: 'baby_changing_station' },
      { name: 'School Fees', icon: 'backpack' },
      { name: 'Toys & Games', icon: 'toys' },
      { name: 'Kids Clothing', icon: 'child_friendly' },
      { name: 'Kids Activities', icon: 'sports_kabaddi' },
    ]
  },
  {
    id: 'pets',
    name: 'Pets',
    icon: 'pets',
    color: '#795548',
    type: 'expense',
    categories: [
      { name: 'Pet Food', icon: 'set_meal' },
      { name: 'Vet & Pet Care', icon: 'healing' },
      { name: 'Pet Supplies', icon: 'inventory_2' },
      { name: 'Pet Grooming', icon: 'content_cut' },
    ]
  },
  {
    id: 'financial',
    name: 'Financial',
    icon: 'account_balance',
    color: '#78909C',
    type: 'expense',
    categories: [
      { name: 'Insurance', icon: 'security' },
      { name: 'Taxes', icon: 'receipt_long' },
      { name: 'Bank Fees', icon: 'credit_card' },
      { name: 'Loans & Debt', icon: 'money_off' },
      { name: 'Investment Fees', icon: 'trending_down' },
    ]
  },
  {
    id: 'gifts',
    name: 'Gifts & Donations',
    icon: 'card_giftcard',
    color: '#CE93D8',
    type: 'expense',
    categories: [
      { name: 'Gifts Given', icon: 'redeem' },
      { name: 'Charity & Donations', icon: 'volunteer_activism' },
      { name: 'Religious Donations', icon: 'church' },
    ]
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    icon: 'subscriptions',
    color: '#B39DDB',
    type: 'expense',
    categories: [
      { name: 'Streaming Services', icon: 'live_tv' },
      { name: 'Software & Apps', icon: 'apps' },
      { name: 'Memberships', icon: 'card_membership' },
      { name: 'News & Magazines', icon: 'newspaper' },
    ]
  },
  {
    id: 'other_expense',
    name: 'Other',
    icon: 'more_horiz',
    color: '#9E9E9E',
    type: 'expense',
    categories: [
      { name: 'Office & Work', icon: 'work' },
      { name: 'Legal & Professional', icon: 'gavel' },
      { name: 'Miscellaneous', icon: 'category' },
    ]
  },
];

// Default Income Category Groups
export const DEFAULT_INCOME_GROUPS: CategoryGroup[] = [
  {
    id: 'employment',
    name: 'Employment',
    icon: 'payments',
    color: '#4CAF50',
    type: 'income',
    categories: [
      { name: 'Salary', icon: 'payments' },
      { name: 'Wages', icon: 'attach_money' },
      { name: 'Bonus', icon: 'celebration' },
      { name: 'Commission', icon: 'percent' },
      { name: 'Overtime', icon: 'schedule' },
      { name: 'Tips', icon: 'savings' },
    ]
  },
  {
    id: 'self_employment',
    name: 'Self-Employment',
    icon: 'store',
    color: '#8BC34A',
    type: 'income',
    categories: [
      { name: 'Freelance', icon: 'work' },
      { name: 'Business Income', icon: 'store' },
      { name: 'Consulting', icon: 'psychology' },
      { name: 'Side Hustle', icon: 'handyman' },
      { name: 'Contract Work', icon: 'description' },
    ]
  },
  {
    id: 'investments',
    name: 'Investments',
    icon: 'trending_up',
    color: '#00BCD4',
    type: 'income',
    categories: [
      { name: 'Dividends', icon: 'pie_chart' },
      { name: 'Interest Income', icon: 'account_balance' },
      { name: 'Capital Gains', icon: 'show_chart' },
      { name: 'Crypto Gains', icon: 'currency_bitcoin' },
      { name: 'Stock Sale', icon: 'sell' },
    ]
  },
  {
    id: 'rental',
    name: 'Rental & Property',
    icon: 'apartment',
    color: '#FF9800',
    type: 'income',
    categories: [
      { name: 'Rental Income', icon: 'apartment' },
      { name: 'Property Sale', icon: 'home' },
      { name: 'Airbnb Income', icon: 'hotel' },
    ]
  },
  {
    id: 'government',
    name: 'Government & Benefits',
    icon: 'account_balance_wallet',
    color: '#2196F3',
    type: 'income',
    categories: [
      { name: 'Tax Refund', icon: 'receipt_long' },
      { name: 'Government Benefits', icon: 'account_balance_wallet' },
      { name: 'Pension', icon: 'elderly' },
      { name: 'Social Security', icon: 'security' },
      { name: 'Unemployment', icon: 'work_off' },
    ]
  },
  {
    id: 'other_income',
    name: 'Other Income',
    icon: 'attach_money',
    color: '#9C27B0',
    type: 'income',
    categories: [
      { name: 'Gift Received', icon: 'card_giftcard' },
      { name: 'Inheritance', icon: 'family_restroom' },
      { name: 'Lottery & Winnings', icon: 'casino' },
      { name: 'Refund', icon: 'replay' },
      { name: 'Cashback & Rewards', icon: 'redeem' },
      { name: 'Reimbursement', icon: 'request_quote' },
      { name: 'Sale of Items', icon: 'sell' },
      { name: 'Scholarship & Grants', icon: 'school' },
      { name: 'Alimony Received', icon: 'family_restroom' },
      { name: 'Miscellaneous', icon: 'attach_money' },
    ]
  },
];

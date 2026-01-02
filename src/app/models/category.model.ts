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
  nameKey: string;  // Translation key, e.g., 'categoryNames.food'
  icon: string;
  color: string;
  type: TransactionType;
  categories: CategoryItem[];
}

export interface CategoryItem {
  nameKey: string;  // Translation key, e.g., 'categoryNames.restaurants'
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
    nameKey: 'categoryNames.food',
    icon: 'restaurant',
    color: '#FF5722',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.restaurants', icon: 'restaurant' },
      { nameKey: 'categoryNames.groceries', icon: 'shopping_cart' },
      { nameKey: 'categoryNames.coffeeAndDrinks', icon: 'local_cafe' },
      { nameKey: 'categoryNames.fastFood', icon: 'fastfood' },
      { nameKey: 'categoryNames.delivery', icon: 'delivery_dining' },
    ]
  },
  {
    id: 'transport',
    nameKey: 'categoryNames.transport',
    icon: 'directions_car',
    color: '#2196F3',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.fuelAndGas', icon: 'local_gas_station' },
      { nameKey: 'categoryNames.parking', icon: 'local_parking' },
      { nameKey: 'categoryNames.publicTransit', icon: 'directions_bus' },
      { nameKey: 'categoryNames.taxiAndRideShare', icon: 'local_taxi' },
      { nameKey: 'categoryNames.carMaintenance', icon: 'car_repair' },
      { nameKey: 'categoryNames.carInsurance', icon: 'verified_user' },
    ]
  },
  {
    id: 'shopping',
    nameKey: 'categoryNames.shopping',
    icon: 'shopping_bag',
    color: '#9C27B0',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.clothingAndFashion', icon: 'checkroom' },
      { nameKey: 'categoryNames.electronics', icon: 'devices' },
      { nameKey: 'categoryNames.homeAndGarden', icon: 'home' },
      { nameKey: 'categoryNames.furniture', icon: 'chair' },
      { nameKey: 'categoryNames.onlineShopping', icon: 'local_shipping' },
    ]
  },
  {
    id: 'entertainment',
    nameKey: 'categoryNames.entertainment',
    icon: 'movie',
    color: '#E91E63',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.moviesAndShows', icon: 'theaters' },
      { nameKey: 'categoryNames.gamesAndHobbies', icon: 'sports_esports' },
      { nameKey: 'categoryNames.musicAndConcerts', icon: 'headphones' },
      { nameKey: 'categoryNames.booksAndMagazines', icon: 'menu_book' },
      { nameKey: 'categoryNames.barsAndNightlife', icon: 'nightlife' },
    ]
  },
  {
    id: 'bills',
    nameKey: 'categoryNames.bills',
    icon: 'receipt',
    color: '#607D8B',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.electricity', icon: 'bolt' },
      { nameKey: 'categoryNames.water', icon: 'water_drop' },
      { nameKey: 'categoryNames.internetAndPhone', icon: 'wifi' },
      { nameKey: 'categoryNames.rentAndMortgage', icon: 'apartment' },
      { nameKey: 'categoryNames.gasAndHeating', icon: 'local_fire_department' },
    ]
  },
  {
    id: 'health',
    nameKey: 'categoryNames.health',
    icon: 'local_hospital',
    color: '#4CAF50',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.doctorAndClinic', icon: 'medical_services' },
      { nameKey: 'categoryNames.pharmacyAndMedicine', icon: 'medication' },
      { nameKey: 'categoryNames.gymAndFitness', icon: 'fitness_center' },
      { nameKey: 'categoryNames.sports', icon: 'sports_soccer' },
      { nameKey: 'categoryNames.mentalHealth', icon: 'psychology' },
    ]
  },
  {
    id: 'personal',
    nameKey: 'categoryNames.personal',
    icon: 'spa',
    color: '#FF9800',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.hairAndBeauty', icon: 'face' },
      { nameKey: 'categoryNames.cosmetics', icon: 'brush' },
      { nameKey: 'categoryNames.spaAndMassage', icon: 'spa' },
      { nameKey: 'categoryNames.laundryAndCleaning', icon: 'local_laundry_service' },
    ]
  },
  {
    id: 'education',
    nameKey: 'categoryNames.education',
    icon: 'school',
    color: '#3F51B5',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.tuitionFees', icon: 'account_balance' },
      { nameKey: 'categoryNames.coursesAndTraining', icon: 'library_books' },
      { nameKey: 'categoryNames.booksAndSupplies', icon: 'auto_stories' },
      { nameKey: 'categoryNames.onlineLearning', icon: 'computer' },
    ]
  },
  {
    id: 'travel',
    nameKey: 'categoryNames.travel',
    icon: 'flight',
    color: '#00BCD4',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.flights', icon: 'flight' },
      { nameKey: 'categoryNames.hotelsAndAccommodation', icon: 'hotel' },
      { nameKey: 'categoryNames.vacationActivities', icon: 'beach_access' },
      { nameKey: 'categoryNames.travelInsurance', icon: 'health_and_safety' },
    ]
  },
  {
    id: 'family',
    nameKey: 'categoryNames.family',
    icon: 'child_care',
    color: '#FF80AB',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.childcare', icon: 'baby_changing_station' },
      { nameKey: 'categoryNames.schoolFees', icon: 'backpack' },
      { nameKey: 'categoryNames.toysAndGames', icon: 'toys' },
      { nameKey: 'categoryNames.kidsClothing', icon: 'child_friendly' },
      { nameKey: 'categoryNames.kidsActivities', icon: 'sports_kabaddi' },
    ]
  },
  {
    id: 'pets',
    nameKey: 'categoryNames.pets',
    icon: 'pets',
    color: '#795548',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.petFood', icon: 'set_meal' },
      { nameKey: 'categoryNames.vetAndPetCare', icon: 'healing' },
      { nameKey: 'categoryNames.petSupplies', icon: 'inventory_2' },
      { nameKey: 'categoryNames.petGrooming', icon: 'content_cut' },
    ]
  },
  {
    id: 'financial',
    nameKey: 'categoryNames.financial',
    icon: 'account_balance',
    color: '#78909C',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.insurance', icon: 'security' },
      { nameKey: 'categoryNames.taxes', icon: 'receipt_long' },
      { nameKey: 'categoryNames.bankFees', icon: 'credit_card' },
      { nameKey: 'categoryNames.loansAndDebt', icon: 'money_off' },
      { nameKey: 'categoryNames.investmentFees', icon: 'trending_down' },
    ]
  },
  {
    id: 'gifts',
    nameKey: 'categoryNames.gifts',
    icon: 'card_giftcard',
    color: '#CE93D8',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.giftsGiven', icon: 'redeem' },
      { nameKey: 'categoryNames.charityAndDonations', icon: 'volunteer_activism' },
      { nameKey: 'categoryNames.religiousDonations', icon: 'church' },
    ]
  },
  {
    id: 'subscriptions',
    nameKey: 'categoryNames.subscriptions',
    icon: 'subscriptions',
    color: '#B39DDB',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.streamingServices', icon: 'live_tv' },
      { nameKey: 'categoryNames.softwareAndApps', icon: 'apps' },
      { nameKey: 'categoryNames.memberships', icon: 'card_membership' },
      { nameKey: 'categoryNames.newsAndMagazines', icon: 'newspaper' },
    ]
  },
  {
    id: 'other_expense',
    nameKey: 'categoryNames.otherExpense',
    icon: 'more_horiz',
    color: '#9E9E9E',
    type: 'expense',
    categories: [
      { nameKey: 'categoryNames.officeAndWork', icon: 'work' },
      { nameKey: 'categoryNames.legalAndProfessional', icon: 'gavel' },
      { nameKey: 'categoryNames.miscellaneous', icon: 'category' },
    ]
  },
];

// Default Income Category Groups
export const DEFAULT_INCOME_GROUPS: CategoryGroup[] = [
  {
    id: 'employment',
    nameKey: 'categoryNames.employment',
    icon: 'payments',
    color: '#4CAF50',
    type: 'income',
    categories: [
      { nameKey: 'categoryNames.salary', icon: 'payments' },
      { nameKey: 'categoryNames.wages', icon: 'attach_money' },
      { nameKey: 'categoryNames.bonus', icon: 'celebration' },
      { nameKey: 'categoryNames.commission', icon: 'percent' },
      { nameKey: 'categoryNames.overtime', icon: 'schedule' },
      { nameKey: 'categoryNames.tips', icon: 'savings' },
    ]
  },
  {
    id: 'self_employment',
    nameKey: 'categoryNames.selfEmployment',
    icon: 'store',
    color: '#8BC34A',
    type: 'income',
    categories: [
      { nameKey: 'categoryNames.freelance', icon: 'work' },
      { nameKey: 'categoryNames.businessIncome', icon: 'store' },
      { nameKey: 'categoryNames.consulting', icon: 'psychology' },
      { nameKey: 'categoryNames.sideHustle', icon: 'handyman' },
      { nameKey: 'categoryNames.contractWork', icon: 'description' },
    ]
  },
  {
    id: 'investments',
    nameKey: 'categoryNames.investments',
    icon: 'trending_up',
    color: '#00BCD4',
    type: 'income',
    categories: [
      { nameKey: 'categoryNames.dividends', icon: 'pie_chart' },
      { nameKey: 'categoryNames.interestIncome', icon: 'account_balance' },
      { nameKey: 'categoryNames.capitalGains', icon: 'show_chart' },
      { nameKey: 'categoryNames.cryptoGains', icon: 'currency_bitcoin' },
      { nameKey: 'categoryNames.stockSale', icon: 'sell' },
    ]
  },
  {
    id: 'rental',
    nameKey: 'categoryNames.rental',
    icon: 'apartment',
    color: '#FF9800',
    type: 'income',
    categories: [
      { nameKey: 'categoryNames.rentalIncome', icon: 'apartment' },
      { nameKey: 'categoryNames.propertySale', icon: 'home' },
      { nameKey: 'categoryNames.airbnbIncome', icon: 'hotel' },
    ]
  },
  {
    id: 'government',
    nameKey: 'categoryNames.government',
    icon: 'account_balance_wallet',
    color: '#2196F3',
    type: 'income',
    categories: [
      { nameKey: 'categoryNames.taxRefund', icon: 'receipt_long' },
      { nameKey: 'categoryNames.governmentBenefits', icon: 'account_balance_wallet' },
      { nameKey: 'categoryNames.pension', icon: 'elderly' },
      { nameKey: 'categoryNames.socialSecurity', icon: 'security' },
      { nameKey: 'categoryNames.unemployment', icon: 'work_off' },
    ]
  },
  {
    id: 'other_income',
    nameKey: 'categoryNames.otherIncome',
    icon: 'attach_money',
    color: '#9C27B0',
    type: 'income',
    categories: [
      { nameKey: 'categoryNames.giftReceived', icon: 'card_giftcard' },
      { nameKey: 'categoryNames.inheritance', icon: 'family_restroom' },
      { nameKey: 'categoryNames.lotteryAndWinnings', icon: 'casino' },
      { nameKey: 'categoryNames.refund', icon: 'replay' },
      { nameKey: 'categoryNames.cashbackAndRewards', icon: 'redeem' },
      { nameKey: 'categoryNames.reimbursement', icon: 'request_quote' },
      { nameKey: 'categoryNames.saleOfItems', icon: 'sell' },
      { nameKey: 'categoryNames.scholarshipAndGrants', icon: 'school' },
      { nameKey: 'categoryNames.alimonyReceived', icon: 'family_restroom' },
      { nameKey: 'categoryNames.miscellaneous', icon: 'attach_money' },
    ]
  },
];

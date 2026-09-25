import { defaultCategories, mergeCategories } from './category-merge.utils';
import { createCategory } from '../services/testing/test-data';
import { DEFAULT_EXPENSE_GROUPS, DEFAULT_INCOME_GROUPS } from '../../models';

/**
 * The built-in ids in their order, written out rather than derived from the
 * catalog. Transactions, budgets and stored overrides name these ids, and a
 * stored row replaces a built-in only by carrying its id, so a changed id
 * orphans every row that points at it: this list changes only with a
 * migration. Grouped one catalog group per line: the group's own id first,
 * then its subcategories.
 */
const DEFAULT_IDS_IN_ORDER: readonly string[] = [
  'food', 'food_restaurants', 'food_groceries', 'food_coffeeAndDrinks', 'food_fastFood',
    'food_delivery', 'food_alcoholAndTobacco', 'food_snacksAndConvenience',
  'transport', 'transport_fuelAndGas', 'transport_parking', 'transport_publicTransit',
    'transport_taxiAndRideShare', 'transport_carMaintenance', 'transport_carInsurance',
    'transport_tolls', 'transport_evCharging',
  'shopping', 'shopping_clothingAndFashion', 'shopping_electronics', 'shopping_homeAndGarden',
    'shopping_furniture', 'shopping_onlineShopping',
  'entertainment', 'entertainment_moviesAndShows', 'entertainment_gamesAndHobbies',
    'entertainment_musicAndConcerts', 'entertainment_booksAndMagazines',
    'entertainment_barsAndNightlife',
  'bills', 'bills_electricity', 'bills_water', 'bills_internetAndPhone', 'bills_rentAndMortgage',
    'bills_gasAndHeating', 'bills_homeMaintenance', 'bills_homeInsurance',
  'health', 'health_doctorAndClinic', 'health_pharmacyAndMedicine', 'health_gymAndFitness',
    'health_sports', 'health_mentalHealth',
  'personal', 'personal_hairAndBeauty', 'personal_cosmetics', 'personal_spaAndMassage',
    'personal_laundryAndCleaning',
  'education', 'education_tuitionFees', 'education_coursesAndTraining', 'education_booksAndSupplies',
    'education_onlineLearning',
  'travel', 'travel_flights', 'travel_hotelsAndAccommodation', 'travel_vacationActivities',
    'travel_travelInsurance',
  'family', 'family_childcare', 'family_schoolFees', 'family_toysAndGames', 'family_kidsClothing',
    'family_kidsActivities',
  'pets', 'pets_petFood', 'pets_vetAndPetCare', 'pets_petSupplies', 'pets_petGrooming',
  'financial', 'financial_insurance', 'financial_taxes', 'financial_bankFees',
    'financial_loansAndDebt', 'financial_investmentFees', 'financial_lifeInsurance',
    'financial_governmentFees',
  'gifts', 'gifts_giftsGiven', 'gifts_charityAndDonations', 'gifts_religiousDonations',
  'subscriptions', 'subscriptions_streamingServices', 'subscriptions_softwareAndApps',
    'subscriptions_memberships', 'subscriptions_newsAndMagazines',
  'other_expense', 'other_expense_officeAndWork', 'other_expense_legalAndProfessional',
    'other_expense_miscellaneous',
  'employment', 'employment_salary', 'employment_wages', 'employment_bonus', 'employment_commission',
    'employment_overtime', 'employment_tips', 'employment_partTimeJob',
  'self_employment', 'self_employment_freelance', 'self_employment_businessIncome',
    'self_employment_consulting', 'self_employment_sideHustle', 'self_employment_contractWork',
    'self_employment_royalties',
  'investments', 'investments_dividends', 'investments_interestIncome', 'investments_capitalGains',
    'investments_cryptoGains', 'investments_stockSale',
  'rental', 'rental_rentalIncome', 'rental_propertySale', 'rental_airbnbIncome',
  'government', 'government_taxRefund', 'government_governmentBenefits', 'government_pension',
    'government_socialSecurity', 'government_unemployment', 'government_childBenefit',
  'other_income', 'other_income_giftReceived', 'other_income_inheritance',
    'other_income_lotteryAndWinnings', 'other_income_refund', 'other_income_cashbackAndRewards',
    'other_income_reimbursement', 'other_income_saleOfItems', 'other_income_scholarshipAndGrants',
    'other_income_alimonyReceived', 'other_income_miscellaneous',
];

describe('category-merge.utils', () => {
  describe('defaultCategories', () => {
    it('generates exactly the stored ids, in their order', () => {
      expect(defaultCategories().map(c => c.id)).toEqual([...DEFAULT_IDS_IN_ORDER]);
    });

    it('numbers the whole catalog in one run from 0, expense groups before income', () => {
      const orders = defaultCategories().map(c => c.order);

      expect(orders).toEqual(DEFAULT_IDS_IN_ORDER.map((_, i) => i));
    });

    it('marks every row as an active, unowned built-in', () => {
      for (const row of defaultCategories()) {
        expect(row.userId).withContext(row.id).toBeNull();
        expect(row.isDefault).withContext(row.id).toBeTrue();
        expect(row.isActive).withContext(row.id).toBeTrue();
      }
    });

    it('builds each row from its catalog group: type by list, colour and parent from the group', () => {
      const byId = new Map(defaultCategories().map(c => [c.id, c]));
      const lists = [
        { groups: DEFAULT_EXPENSE_GROUPS, type: 'expense' },
        { groups: DEFAULT_INCOME_GROUPS, type: 'income' },
      ] as const;

      for (const { groups, type } of lists) {
        for (const group of groups) {
          const head = byId.get(group.id)!;
          expect(head).withContext(group.id).toEqual(jasmine.objectContaining({
            name: group.nameKey, icon: group.icon, color: group.color, type,
          }));
          expect(head.parentId).withContext(group.id).toBeUndefined();

          for (const item of group.categories) {
            const leaf = item.nameKey.split('.').pop();
            const row = byId.get(`${group.id}_${leaf}`)!;
            expect(row).withContext(`${group.id}_${leaf}`).toEqual(jasmine.objectContaining({
              name: item.nameKey, icon: item.icon, color: group.color, type, parentId: group.id,
            }));
          }
        }
      }
    });

    // The list lands in signals and write payloads; a shared one would let one
    // caller's edit reach every other.
    it('hands out a fresh list of fresh rows on every call', () => {
      const first = defaultCategories();
      first[0].name = 'edited';
      first.pop();

      const second = defaultCategories();

      expect(second).not.toBe(first);
      expect(second[0].name).toBe(DEFAULT_EXPENSE_GROUPS[0].nameKey);
      expect(second.length).toBe(DEFAULT_IDS_IN_ORDER.length);
    });
  });

  describe('mergeCategories', () => {
    const builtIns = [
      createCategory({ id: 'food', name: 'categoryNames.food', order: 0 }),
      createCategory({ id: 'food_groceries', name: 'categoryNames.groceries', order: 1, parentId: 'food' }),
      createCategory({ id: 'salary', name: 'categoryNames.salary', type: 'income', order: 2 }),
    ];

    it('replaces a built-in with the stored row carrying its id', () => {
      const stored = createCategory({
        id: 'food_groceries', userId: 'u1', name: 'My groceries', order: 1, parentId: 'food',
        isDefault: false,
      });

      const merged = mergeCategories(builtIns, [stored]);

      expect(merged.filter(c => c.id === 'food_groceries')).toEqual([stored]);
      expect(merged.map(c => c.id)).toEqual(['food', 'food_groceries', 'salary']);
    });

    it('keeps a soft-deleted override in place of its built-in rather than reviving the built-in', () => {
      const removed = createCategory({ id: 'salary', userId: 'u1', order: 2, isActive: false });

      const merged = mergeCategories(builtIns, [removed]);

      expect(merged.find(c => c.id === 'salary')).toBe(removed);
    });

    it('appends a stored row whose id no built-in has', () => {
      const custom = createCategory({ id: 'hobbies', userId: 'u1', name: 'Hobbies', order: 3 });

      const merged = mergeCategories(builtIns, [custom]);

      expect(merged.map(c => c.id)).toEqual(['food', 'food_groceries', 'salary', 'hobbies']);
    });

    it('sorts by order, not by which side a row came from', () => {
      const early = createCategory({ id: 'early', userId: 'u1', order: -1 });
      const middle = createCategory({ id: 'middle', userId: 'u1', order: 1.5 });

      const merged = mergeCategories(builtIns, [middle, early]);

      expect(merged.map(c => c.id)).toEqual(['early', 'food', 'food_groceries', 'middle', 'salary']);
    });

    it('puts a built-in before a stored row on an order tie', () => {
      const tie = createCategory({ id: 'tie', userId: 'u1', order: 1 });

      const merged = mergeCategories(builtIns, [tie]);

      expect(merged.map(c => c.id)).toEqual(['food', 'food_groceries', 'tie', 'salary']);
    });

    it('answers the built-ins alone when nothing is stored', () => {
      expect(mergeCategories(builtIns, [])).toEqual(builtIns);
    });

    it('leaves both inputs as they were', () => {
      const defaults = [...builtIns].reverse();
      const stored = [createCategory({ id: 'z', userId: 'u1', order: -5 })];
      const defaultsBefore = [...defaults];
      const storedBefore = [...stored];

      const merged = mergeCategories(defaults, stored);

      expect(merged).not.toBe(defaults);
      expect(merged).not.toBe(stored);
      expect(defaults).toEqual(defaultsBefore);
      expect(stored).toEqual(storedBefore);
    });
  });
});

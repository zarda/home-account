import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { DocumentData, Timestamp, deleteField, serverTimestamp } from '@angular/fire/firestore';
import { BatchOp, BatchStamp, FirestoreService, QueryOptions } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { HouseholdError } from './household.service';
import {
  HouseholdLedgerService,
  LedgerHousehold,
  StoredLedgerCopy,
  readableCopy,
  sameHousehold
} from './household-ledger.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import {
  BudgetPeriod,
  HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK,
  HOUSEHOLD_PLAN_CATEGORY_MAX,
  HOUSEHOLD_PLAN_NAME_LENGTH,
  HouseholdBudget,
  HouseholdContribution,
  HouseholdGoal,
  LEDGER_QUERY_SHAPES,
  isBudgetPeriod,
  ledgerCopyPath
} from '../../models';
import { CappedFeed, UNHEARD, openCappedFeed } from '../utils/capped-feed.utils';
import { errorCode, isRefused } from '../utils/firebase-error.utils';
import { chunked, isStamp, sameStamp } from '../utils/household-index.utils';
import {
  BudgetSpent,
  ConvertAtTodaysRate,
  GoalProgress,
  budgetSpent,
  goalProgress,
  isAmount,
  isHouseholdBudgetCategory,
  planWindow
} from '../utils/household-plans.utils';
import { compareIds } from '../utils/transaction-aggregation.utils';

/** A new household budget. Its currency is chosen here, once: the maker's base unless they pick another. */
export interface HouseholdBudgetInput {
  name: string;
  /**
   * Expense built-in ids, groups or subcategories (isHouseholdBudgetCategory);
   * a repeated one is kept once, and any other is refused.
   */
  categoryIds: readonly string[];
  amount: number;
  currency: string;
  period: BudgetPeriod;
  startDate: Date;
  endDate?: Date | null;
  /** The percentage of the amount at which the budget warns. */
  alertThreshold?: number | null;
}

/** An edit to a household budget. The currency is fixed; null clears an end date or an alert threshold. */
export type HouseholdBudgetChanges = Partial<Omit<HouseholdBudgetInput, 'currency'> & { isActive: boolean }>;

/** A new household goal. Its currency is chosen here, once, and contributions are entered in it. */
export interface HouseholdGoalInput {
  name: string;
  targetAmount: number;
  currency: string;
  targetDate?: Date | null;
}

/** An edit to a household goal. The currency is fixed; null clears the target date. */
export type HouseholdGoalChanges = Partial<Omit<HouseholdGoalInput, 'currency'> & { isActive: boolean }>;

/** One of the household's budgets with what it has spent in its current window. */
export interface HouseholdBudgetFigures extends BudgetSpent {
  budget: HouseholdBudget;
  /**
   * The window may count more than was read: the ledger kept only its newest
   * LEDGER_VIEW_CAP copies and they stop short of the window's start, or the
   * ledger's listener failed before the server answered.
   */
  incomplete: boolean;
  /**
   * The copies its window reads have not answered yet, so `spent` counts
   * none of them: a figure to wait for, not a zero. Or it converted a copy
   * before today's rates had loaded, at the placeholder's 1:1.
   */
  counting: boolean;
}

/** One of the household's goals with its progress. */
export interface HouseholdGoalFigures extends GoalProgress {
  goal: HouseholdGoal;
  /** The live members' contributions, newest first. */
  contributions: readonly HouseholdContribution[];
  /** More contributions or linked copies were held than were read, or their listener failed before answering. */
  incomplete: boolean;
  /**
   * Its contributions or the linked copies have not answered yet, so its
   * progress counts none of them: a figure to wait for, not a zero. Or it
   * converted a linked copy before today's rates had loaded, at the
   * placeholder's 1:1.
   */
  counting: boolean;
}

/** The most values a Firestore `in` filter takes. */
const GOAL_IDS_PER_QUERY = 30;

const LOG = '[HouseholdPlans]';

const isDate = (value: unknown): value is Date => value instanceof Date && !Number.isNaN(value.getTime());

/** The plan made first comes first; one whose creation the server has not stamped yet comes last. */
function madeFirst(a: HouseholdBudget | HouseholdGoal, b: HouseholdBudget | HouseholdGoal): number {
  const at = (plan: HouseholdBudget | HouseholdGoal) =>
    isStamp(plan.createdAt) ? plan.createdAt.toMillis() : Number.POSITIVE_INFINITY;
  return at(a) - at(b) || compareIds(a.id, b.id);
}

const readableBudget = (budget: HouseholdBudget) =>
  typeof budget.name === 'string' && typeof budget.currency === 'string' && isAmount(budget.amount);

const readableGoal = (goal: HouseholdGoal) =>
  typeof goal.name === 'string' && typeof goal.currency === 'string' && isAmount(goal.targetAmount);

/** A household and its generation, as a key. */
const householdKey = (household: LedgerHousehold) =>
  `${household.id}|${household.createdAt.seconds}.${household.createdAt.nanoseconds}`;

/**
 * A query built from its composite's shape (LEDGER_QUERY_SHAPES): the
 * equality on the generation first, as the rules require of a member's list,
 * then the shape's second field by `second`.
 */
function byShape(
  shape: keyof typeof LEDGER_QUERY_SHAPES,
  gen: Timestamp,
  second: (field: string, order: 'asc' | 'desc') => Pick<QueryOptions, 'where' | 'orderBy'>
): QueryOptions {
  const [[genField], [field, order]] = LEDGER_QUERY_SHAPES[shape].fields;
  const rest = second(field, order === 'DESCENDING' ? 'desc' : 'asc');
  return {
    where: [{ field: genField, op: '==', value: gen }, ...(rest.where ?? [])],
    ...(rest.orderBy ? { orderBy: rest.orderBy } : {})
  };
}

/**
 * A household's own budgets and goals (#71): made, edited and deleted by any
 * live member, and counted only from what the household holds. A budget's
 * spending is folded from the copies its members shared, as the ledger view
 * reads them (HouseholdLedgerService), never from a member's private rows;
 * a goal's progress from the copies its members linked to it and the
 * contributions they recorded on it. Nothing a plan counts is stored.
 *
 * Provided by the household page beside HouseholdLedgerService, and read
 * with it: its listeners live as long as the page, and the DestroyRef closes
 * them (ADR 0009). The page hands in the household; the ledger's live
 * members decide whose copies and contributions count.
 *
 * Listeners, each in the shape of a declared composite
 * (LEDGER_QUERY_SHAPES), filtered to the household's live generation as the
 * rules require of a member's list:
 * - the active budgets, and the active goals;
 * - each active goal's contributions, newest first;
 * - the copies linked to the active goals, GOAL_IDS_PER_QUERY goal ids at a
 *   time.
 * The budgets' spending is read by the ledger (setPlanWindow): through the
 * period's listener when the period holds the budgets' window, otherwise
 * through a capped listener of its own. Each budget folds the copies read.
 *
 * A refusal of a listener is the rules saying the membership has ended;
 * HouseholdService reports that loss, and the listener stops quietly. Any
 * other failure is logged, and what was shown stays; before the server had
 * answered, the figures are marked as possibly incomplete. The ledger's
 * listeners keep the same rule, from the same place (openCappedFeed), so a
 * budget and a goal never disagree on it.
 *
 * Every write needs the network, as every other household change does, and
 * commits in a transaction (FirestoreService.commitOnline), never through
 * the persistent mutation queue: a plan write kept on the device would land
 * days later over what the household changed meanwhile, or be refused then
 * unseen. A write whose connection drops fails, and says so; on a network
 * that silently drops traffic it waits as long as the browser does, since
 * nothing bounds it, but nothing is kept to be sent once the page is gone.
 * The server may have taken a write before the connection dropped, so a
 * create that fails that way says it may have landed. Only the sweep of a
 * deleted goal's contributions commits through the queue: deleting a
 * contribution already gone does nothing. A link waits first for this
 * device's earlier writes, since the copy it changes may be among them
 * (linkCopy).
 *
 * A create sent again, by the transaction's runner after its answer was
 * lost or by another save of the same dialog under the id made for it
 * (newId), is judged by the rules as a change to the document its first
 * delivery made, and refused; the document is read back from the server,
 * and one this member made in this generation means the write landed
 * (ADR 0156).
 */
@Injectable()
export class HouseholdPlansService {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly currency = inject(CurrencyService);
  private readonly pwa = inject(PwaService);
  private readonly translation = inject(TranslationService);
  private readonly ledger = inject(HouseholdLedgerService);

  private readonly household = signal<LedgerHousehold | null>(null, { equal: sameHousehold });
  /** The moment the budgets' windows are judged at. */
  private readonly now = signal(new Date());
  private readonly budgetFeed = signal<CappedFeed<HouseholdBudget>>(UNHEARD);
  private readonly goalFeed = signal<CappedFeed<HouseholdGoal>>(UNHEARD);
  private readonly contributionFeeds = signal<ReadonlyMap<string, CappedFeed<HouseholdContribution>>>(new Map());
  private readonly linkFeeds = signal<readonly CappedFeed<StoredLedgerCopy>[]>([]);

  private budgetsListener: Subscription | null = null;
  private goalsListener: Subscription | null = null;
  private readonly contributionListeners = new Map<string, Subscription>();
  private linkListeners: Subscription[] = [];
  /** The goal ids the link listeners read, sorted and joined. */
  private linkedGoals = '';
  /**
   * Goals deleted while this page lives whose contributions were not all
   * removed once the goal was gone, keyed by householdKey and goal id. No
   * listener reaches a gone goal's contributions, so this is the only
   * record of them; each is swept again when the device is back online, or
   * when the page reads a household afresh.
   */
  private readonly unswept = new Map<string, { household: LedgerHousehold; goalId: string }>();
  private sweeping = false;
  private destroyed = false;
  /** Told each time the device goes offline (earlierWritesAnswered). */
  private readonly wentOffline = new Subject<void>();

  /** Converts at today's rate; reading the rates, so a rates change refolds every converted figure. */
  private readonly convert: ConvertAtTodaysRate = (amount, from, to) => this.currency.convert(amount, from, to);

  /**
   * The rate table has settled on a source. Until then it is a placeholder
   * that converts every currency 1:1, so a figure that converted is one to
   * wait for; read only for such a figure, so a plan in one currency never
   * waits on the rates.
   */
  private readonly ratesSettled = computed(() => this.currency.rateSource() !== null);

  /** The active budgets in the order they were made, each with its spending in its current window. */
  readonly budgets = computed<HouseholdBudgetFigures[]>(() => {
    const copies = this.ledger.windowCopies();
    const keptFrom = this.ledger.windowKeptFrom();
    const ledgerFailed = this.ledger.windowIncomplete();
    const unread = this.ledger.windowLoading();
    const now = this.now();
    return (this.budgetFeed().docs ?? [])
      .filter(readableBudget)
      .sort(madeFirst)
      .map(budget => {
        const figure = budgetSpent(budget, copies, now, this.convert);
        const cut = figure.window !== null && keptFrom !== null && keptFrom >= figure.window.start.getTime();
        return {
          budget,
          ...figure,
          incomplete: ledgerFailed || cut,
          counting: (unread && figure.window !== null) || (figure.atTodaysRate && !this.ratesSettled())
        };
      });
  });

  /** The active goals in the order they were made, each with its progress. */
  readonly goals = computed<HouseholdGoalFigures[]>(() => {
    const members = this.ledger.memberUids();
    const linkFeeds = this.linkFeeds();
    const linked = linkFeeds
      .flatMap(feed => feed.docs ?? [])
      .filter(copy => members.has(copy.memberUid) && readableCopy(copy));
    const linksCut = linkFeeds.some(feed => feed.truncated || feed.incomplete);
    const linksUnread = linkFeeds.some(feed => feed.docs === undefined);
    const contributionFeeds = this.contributionFeeds();
    return (this.goalFeed().docs ?? [])
      .filter(readableGoal)
      .sort(madeFirst)
      .map(goal => {
        const feed = contributionFeeds.get(goal.id) ?? UNHEARD;
        const contributions = (feed.docs ?? []).filter(contribution => members.has(contribution.memberUid));
        // Contributions are in the goal's currency: only a linked copy converts.
        const progress = goalProgress(goal, linked, contributions, this.convert);
        return {
          goal,
          ...progress,
          contributions,
          incomplete: linksCut || feed.truncated || feed.incomplete,
          counting: linksUnread || feed.docs === undefined || (progress.atTodaysRate && !this.ratesSettled())
        };
      });
  });

  /** A household is set, and some list, or the ledger's copies the budgets fold, has not answered yet. */
  readonly loading = computed(() => {
    if (!this.household()) return false;
    const goals = this.goalFeed().docs;
    if (this.budgetFeed().docs === undefined || goals === undefined || this.ledger.windowLoading()) return true;
    const contributions = this.contributionFeeds();
    return goals.some(goal => contributions.get(goal.id)?.docs === undefined)
      || this.linkFeeds().some(feed => feed.docs === undefined);
  });

  /** The budgets' or the goals' listener failed before the server answered: the lists may be incomplete. */
  readonly incomplete = computed(() => this.budgetFeed().incomplete || this.goalFeed().incomplete);

  /** Something shown came from this device's cache, not yet in step with the server. */
  readonly fromCache = computed(() =>
    this.budgetFeed().fromCache
    || this.goalFeed().fromCache
    || [...this.contributionFeeds().values()].some(feed => feed.fromCache)
    || this.linkFeeds().some(feed => feed.fromCache)
    || this.ledger.windowFromCache()
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.closeAll();
    });
    // What a goal deleted while the connection dropped left of its
    // contributions is removed once the device is back online; a wait on
    // the connection ends once it is lost.
    effect(() => {
      if (this.pwa.isOnline()) untracked(() => void this.resumeSweeps());
      else untracked(() => this.wentOffline.next());
    });
  }

  /** The household whose plans are read and written; null reads nothing. Another household or generation is read afresh. */
  setHousehold(household: LedgerHousehold | null): void {
    // Untracked: the page calls this from an effect, and a listener can
    // answer synchronously inside it.
    untracked(() => {
      if (this.destroyed) return;
      const next = household && { id: household.id, ownerId: household.ownerId, createdAt: household.createdAt };
      if (sameHousehold(this.household(), next)) return;
      this.household.set(next);
      this.listen();
    });
  }

  /**
   * The moment the budgets' windows are judged at: the time the service was
   * made, until the page moves it on (a new day, say).
   */
  setNow(now: Date): void {
    untracked(() => {
      if (this.destroyed || !isDate(now)) return;
      this.now.set(now);
      this.shareWindow();
    });
  }

  // ---- writes ----

  /**
   * An id for one create, made before its first attempt. Given to every
   * attempt at that create (each save of one dialog), it lets an attempt
   * sent again after its answer was lost be recognised on the server as
   * the delivery that landed, rather than made a second time. A create
   * given no id makes its own, which serves that one call alone.
   */
  newId(): string {
    // Firestore draws an id alike for every collection.
    return this.firestore.generateId('households');
  }

  /** Makes a budget for the household under `id` (newId), answering it. Refused offline. */
  async createBudget(input: HouseholdBudgetInput, id?: string): Promise<string> {
    const { household, uid } = this.writer();
    return this.attempt(async () => {
      const currency = this.currencyCode(input.currency);
      const data: DocumentData = {
        gen: household.createdAt,
        ...this.budgetFields(input, 'create'),
        currency,
        isActive: true,
        createdBy: uid,
        createdAt: serverTimestamp()
      };
      const collection = `households/${household.id}/budgets`;
      const path = `${collection}/${id ?? this.firestore.generateId(collection)}`;
      await this.create<HouseholdBudget>(path, data, 'server', stored =>
        stored.createdBy === uid && sameStamp(stored.gen, household.createdAt));
      return this.idOf(path);
    });
  }

  /** Edits a budget: only the fields given, never its currency. Refused offline. */
  async updateBudget(budgetId: string, changes: HouseholdBudgetChanges): Promise<void> {
    const { household } = this.writer();
    return this.attempt(async () => {
      const data = this.budgetFields(changes, 'update');
      if (Object.keys(data).length === 0) return;
      const path = `households/${household.id}/budgets/${budgetId}`;
      await this.firestore.commitOnline([{ op: 'update', path, data, stamp: 'server' }])
        .catch(async (error: unknown) => { throw await this.whyRefused(error, path); });
    });
  }

  /**
   * Deletes a budget. The rules let its maker, while a member, and the
   * household's owner do so; anyone else is told before anything is sent.
   * Refused offline.
   */
  async deleteBudget(budgetId: string): Promise<void> {
    const { household, uid } = this.writer();
    return this.attempt(async () => {
      const listed = this.budgetFeed().docs?.find(budget => budget.id === budgetId);
      if (listed) this.refuseUnlessMaker(listed.createdBy, household, uid, this.t('household.errors.planNotYours'));
      await this.firestore.commitOnline([{ op: 'delete', path: `households/${household.id}/budgets/${budgetId}` }]);
    });
  }

  /** Makes a goal for the household under `id` (newId), answering it. Refused offline. */
  async createGoal(input: HouseholdGoalInput, id?: string): Promise<string> {
    const { household, uid } = this.writer();
    return this.attempt(async () => {
      const currency = this.currencyCode(input.currency);
      const data: DocumentData = {
        gen: household.createdAt,
        ...this.goalFields(input, 'create'),
        currency,
        isActive: true,
        createdBy: uid,
        createdAt: serverTimestamp()
      };
      const collection = `households/${household.id}/goals`;
      const path = `${collection}/${id ?? this.firestore.generateId(collection)}`;
      await this.create<HouseholdGoal>(path, data, 'server', stored =>
        stored.createdBy === uid && sameStamp(stored.gen, household.createdAt));
      return this.idOf(path);
    });
  }

  /** Edits a goal: only the fields given, never its currency. Refused offline. */
  async updateGoal(goalId: string, changes: HouseholdGoalChanges): Promise<void> {
    const { household } = this.writer();
    return this.attempt(async () => {
      const data = this.goalFields(changes, 'update');
      if (Object.keys(data).length === 0) return;
      const path = `households/${household.id}/goals/${goalId}`;
      await this.firestore.commitOnline([{ op: 'update', path, data, stamp: 'server' }])
        .catch(async (error: unknown) => { throw await this.whyRefused(error, path); });
    });
  }

  /**
   * Deletes a goal and every contribution recorded on it. A goal's delete
   * does not reach its contributions, and the rules let a live member delete
   * another's contribution only once its goal is gone as the commit leaves
   * it: so the goal's delete lands with the first
   * {@link HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK} contributions, and once it is
   * gone the rest are listed again, any a member added in the meantime with
   * them (no more can be), and deleted in commits of that size. Refused
   * offline; the maker, while a member, and the owner may delete a goal.
   *
   * The call rejects when the contributions could not be listed or the
   * goal's own commit failed. Otherwise it resolves once the sweep of the
   * rest has run, whether or not that sweep removed them all: the goal is
   * gone, no listener shows it, and the page could not offer it again. A
   * sweep that stopped part-way leaves the contributions it did not reach
   * on the server, counted by no goal, and is run again each time the
   * device is back online and whenever the page reads a household afresh,
   * for as long as the page lives (resumeSweeps). One the rules refused is
   * not run again, and is only logged.
   *
   * Copies linked to the goal keep their link, which only their authors can
   * change; a goal that is gone counts nothing.
   */
  async deleteGoal(goalId: string): Promise<void> {
    const { household, uid } = this.writer();
    return this.attempt(async () => {
      const listed = this.goalFeed().docs?.find(goal => goal.id === goalId);
      if (listed) this.refuseUnlessMaker(listed.createdBy, household, uid, this.t('household.errors.planNotYours'));
      const before = await this.listContributions(household, goalId);
      await this.firestore.commitOnline([
        { op: 'delete', path: `households/${household.id}/goals/${goalId}` },
        ...this.contributionDeletes(household, goalId, before.slice(0, HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK))
      ]);
      await this.sweepOrKeep(household, goalId);
    });
  }

  /**
   * Records what the viewer puts toward a goal, in the goal's currency,
   * under `id` (newId), answering it. Refused offline, and by the rules
   * once the goal is gone.
   */
  async addContribution(goalId: string, amount: number, date: Date, id?: string): Promise<string> {
    const { household, uid } = this.writer();
    return this.attempt(async () => {
      this.requireAmount(amount);
      if (!isDate(date)) throw new Error('A contribution needs a date');
      const goalPath = `households/${household.id}/goals/${goalId}`;
      const collection = `${goalPath}/contributions`;
      const path = `${collection}/${id ?? this.firestore.generateId(collection)}`;
      const data: DocumentData = {
        gen: household.createdAt,
        memberUid: uid,
        amount,
        date: Timestamp.fromDate(date),
        createdAt: serverTimestamp()
      };
      // No stamp: a contribution is never changed, and holds no updatedAt.
      await this.create<HouseholdContribution>(path, data, false, stored =>
        stored.memberUid === uid && sameStamp(stored.gen, household.createdAt))
        .catch(async (error: unknown) => { throw await this.whyRefused(error, goalPath); });
      return this.idOf(path);
    });
  }

  /**
   * Deletes a contribution. The rules let its author and the household's
   * owner do so while its goal stands; anyone else is told before anything
   * is sent. Refused offline.
   */
  async deleteContribution(goalId: string, contributionId: string): Promise<void> {
    const { household, uid } = this.writer();
    return this.attempt(async () => {
      const listed = this.contributionFeeds().get(goalId)?.docs?.find(contribution => contribution.id === contributionId);
      if (listed) this.refuseUnlessMaker(listed.memberUid, household, uid, this.t('household.errors.contributionNotYours'));
      await this.firestore.commitOnline([
        { op: 'delete', path: `households/${household.id}/goals/${goalId}/contributions/${contributionId}` }
      ]);
    });
  }

  /**
   * Counts the viewer's own shared row toward a household goal, or stops
   * counting it (null): the link on the row's copy, which only its author
   * changes, and nothing else of it. A goal the household does not hold is
   * refused before anything is sent.
   *
   * Refused offline, and committed online, as a plan write is: a link kept
   * on the device and refused when it landed (its goal deleted meanwhile,
   * say) would roll back unseen, and nothing repairs a link later, since the
   * journal and the sweeps leave goalId alone.
   *
   * A row just shared has its copy written through the device's queue,
   * which a transaction does not wait behind: the link would find no copy
   * on the server and call it gone. So the link first waits for the server
   * to answer this device's earlier writes, and going offline meanwhile
   * refuses it as offline.
   */
  async linkCopy(sourceId: string, goalId: string | null): Promise<void> {
    const { household, uid } = this.writer();
    return this.attempt(async () => {
      const goals = this.goalFeed().docs;
      if (goalId !== null && goals && !goals.some(goal => goal.id === goalId)) {
        throw new HouseholdError(this.t('household.errors.planGone'));
      }
      const path = ledgerCopyPath(household.id, uid, sourceId);
      await this.earlierWritesAnswered();
      try {
        await this.firestore.commitOnline([{ op: 'update', path, data: { goalId: goalId ?? deleteField() }, stamp: 'server' }]);
      } catch (error) {
        const code = errorCode(error);
        if (code !== 'permission-denied' && code !== 'not-found') throw error;
        if ((await this.storedOrUnknown(path)) === null) {
          throw new HouseholdError(this.t('household.errors.copyGone'), { cause: error });
        }
        if (goalId === null) throw error;
        throw await this.whyRefused(error, `households/${household.id}/goals/${goalId}`);
      }
    });
  }

  // ---- listeners ----

  /** (Re)opens the budgets' and goals' listeners for the household, dropping what the last ones said. */
  private listen(): void {
    this.closeAll();
    this.budgetFeed.set(UNHEARD);
    this.goalFeed.set(UNHEARD);
    this.contributionFeeds.set(new Map());
    this.linkFeeds.set([]);
    this.shareWindow();
    const household = this.household();
    if (!household) return;
    void this.resumeSweeps();
    const active = (field: string) => ({ where: [{ field, op: '==' as const, value: true }] });
    this.budgetsListener = this.open<HouseholdBudget>(
      `households/${household.id}/budgets`,
      byShape('activeBudgets', household.createdAt, active),
      false,
      'budgets',
      feed => {
        this.budgetFeed.set(feed);
        this.shareWindow();
      }
    );
    this.goalsListener = this.open<HouseholdGoal>(
      `households/${household.id}/goals`,
      byShape('activeGoals', household.createdAt, active),
      false,
      'goals',
      feed => {
        this.goalFeed.set(feed);
        this.followGoals();
      }
    );
  }

  /** Hands the ledger the dates the active budgets count now, so their copies are read. */
  private shareWindow(): void {
    this.ledger.setPlanWindow(planWindow(this.budgetFeed().docs ?? [], this.now()));
  }

  /**
   * Keeps one contributions listener per active goal, and the link listeners
   * on exactly the active goals' ids: a goal's own listener stays open while
   * it is listed, and the links are read afresh when the ids change.
   */
  private followGoals(): void {
    const household = this.household();
    if (!household || this.destroyed) return;
    const ids = [...new Set((this.goalFeed().docs ?? []).map(goal => goal.id))].sort(compareIds);

    // A goal's feed outlives a listener that failed as it opened, so both are looked through.
    const followed = new Set([...this.contributionListeners.keys(), ...this.contributionFeeds().keys()]);
    for (const goalId of followed) {
      if (ids.includes(goalId)) continue;
      this.contributionListeners.get(goalId)?.unsubscribe();
      this.contributionListeners.delete(goalId);
      this.contributionFeeds.update(feeds => {
        const next = new Map(feeds);
        next.delete(goalId);
        return next;
      });
    }
    for (const goalId of ids) {
      if (followed.has(goalId)) continue;
      this.contributionFeeds.update(feeds => new Map(feeds).set(goalId, UNHEARD));
      const listener = this.open<HouseholdContribution>(
        `households/${household.id}/goals/${goalId}/contributions`,
        byShape('contributionsByDate', household.createdAt, (field, direction) => ({ orderBy: [{ field, direction }] })),
        true,
        'contributions',
        feed => this.contributionFeeds.update(feeds => new Map(feeds).set(goalId, feed))
      );
      if (listener) this.contributionListeners.set(goalId, listener);
    }

    const linked = ids.join('/');
    if (linked === this.linkedGoals) return;
    this.closeLinks();
    this.linkedGoals = linked;
    const chunks = chunked(ids, GOAL_IDS_PER_QUERY);
    this.linkFeeds.set(chunks.map(() => UNHEARD));
    chunks.forEach((chunk, index) => {
      const listener = this.open<StoredLedgerCopy>(
        `households/${household.id}/ledger`,
        byShape('ledgerByGoal', household.createdAt, field => ({ where: [{ field, op: 'in', value: chunk }] })),
        true,
        'linked copies',
        feed => this.linkFeeds.update(feeds => feeds.map((each, i) => (i === index ? feed : each)))
      );
      if (listener) this.linkListeners.push(listener);
    });
  }

  /**
   * Opens one listener, handing each answer to `heard`, by the rule every
   * capped household list keeps (openCappedFeed). Answers null when the
   * listener failed while it was being opened.
   */
  private open<T>(
    path: string,
    query: QueryOptions,
    capped: boolean,
    what: string,
    heard: (feed: CappedFeed<T>) => void
  ): Subscription | null {
    return openCappedFeed(this.firestore, path, query, { capped, what, log: LOG }, heard);
  }

  private closeLinks(): void {
    for (const listener of this.linkListeners) listener.unsubscribe();
    this.linkListeners = [];
    this.linkedGoals = '';
  }

  private closeAll(): void {
    this.budgetsListener?.unsubscribe();
    this.budgetsListener = null;
    this.goalsListener?.unsubscribe();
    this.goalsListener = null;
    for (const listener of this.contributionListeners.values()) listener.unsubscribe();
    this.contributionListeners.clear();
    this.closeLinks();
  }

  // ---- write helpers ----

  /** The signed-in account and the household written to; neither is a condition a member meets by acting. */
  private writer(): { household: LedgerHousehold; uid: string } {
    const uid = this.auth.userId();
    if (!uid) throw new Error('User not authenticated');
    const household = this.household();
    if (!household) throw new Error('No household is selected');
    return { household, uid };
  }

  /** Refuses offline before anything starts, and puts every failure into words. */
  private async attempt<T>(work: () => Promise<T>): Promise<T> {
    if (!this.pwa.isOnline()) throw new HouseholdError(this.t('household.errors.offline'));
    try {
      return await work();
    } catch (error) {
      throw this.failure(error);
    }
  }

  private failure(error: unknown): HouseholdError {
    if (error instanceof HouseholdError) return error;
    const code = errorCode(error);
    if (code === 'permission-denied') return new HouseholdError(this.t('household.errors.refused'), { cause: error });
    if (this.lostConnection(error)) return new HouseholdError(this.t('household.errors.offline'), { cause: error });
    return new HouseholdError(this.t('errors.generic'), { cause: error });
  }

  private lostConnection(error: unknown): boolean {
    const code = errorCode(error);
    return !this.pwa.isOnline() || code === 'unavailable' || code === 'deadline-exceeded';
  }

  /**
   * Sets a new document, resolving when it landed. A refusal is read back
   * from the server: the id was made for this one create (newId), so a
   * document there that `ours` recognises (this member made it, in this
   * generation) is an earlier delivery of it: the first, sent again after
   * its answer was lost, or an earlier save of the same dialog, its fields
   * perhaps changed since. The write is done, as that delivery sent it.
   * Anything else passes the refusal on. A connection lost on the way
   * leaves unknown whether the create landed, and the failure says it may
   * have: saved again under the same id, it is recognised, not made twice.
   */
  private async create<T>(path: string, data: DocumentData, stamp: BatchStamp, ours: (stored: T) => boolean): Promise<void> {
    try {
      await this.firestore.commitOnline([{ op: 'set', path, data, stamp }]);
    } catch (error) {
      if (!isRefused(error)) {
        throw this.lostConnection(error)
          ? new HouseholdError(this.t('household.errors.unconfirmed'), { cause: error })
          : error;
      }
      const stored = await this.firestore.getDocumentFromServer<T>(path).catch(() => null);
      if (stored && ours(stored)) return;
      throw error;
    }
  }

  /**
   * Resolves once the server has answered every write this device issued
   * before the call: the whole queue, as the SDK waits on no single write.
   * Offline that wait lasts until the connection returns, so going offline
   * meanwhile refuses, as a write asked for offline is refused.
   */
  private async earlierWritesAnswered(): Promise<void> {
    let stop = (): void => undefined;
    const cut = new Promise<never>((_, reject) => {
      const offline = this.wentOffline.subscribe(() => reject(new HouseholdError(this.t('household.errors.offline'))));
      stop = () => offline.unsubscribe();
    });
    try {
      await Promise.race([this.firestore.waitForPendingWrites(), cut]);
    } finally {
      stop();
    }
  }

  /**
   * A write to a plan refused, or finding nothing, put into words by what
   * the server holds at `planPath` now: nothing there means the plan is
   * gone. A read the server does not answer leaves the refusal as it was.
   */
  private async whyRefused(error: unknown, planPath: string): Promise<unknown> {
    const code = errorCode(error);
    if (code !== 'permission-denied' && code !== 'not-found') return error;
    if ((await this.storedOrUnknown(planPath)) === null) {
      return new HouseholdError(this.t('household.errors.planGone'), { cause: error });
    }
    return new HouseholdError(this.t('household.errors.refused'), { cause: error });
  }

  /** The document as the server holds it, null when there is none, or undefined when the server did not say. */
  private async storedOrUnknown(path: string): Promise<unknown> {
    try {
      return await this.firestore.getDocumentFromServer(path);
    } catch {
      return undefined;
    }
  }

  /** Refuses, with `message`, anyone but the plan's maker and the household's owner. */
  private refuseUnlessMaker(maker: unknown, household: LedgerHousehold, uid: string, message: string): void {
    if (maker !== uid && household.ownerId !== uid) throw new HouseholdError(message);
  }

  // ---- a deleted goal's contributions ----

  /**
   * A goal's contributions of this generation, as the server holds them: a
   * different query from the goal's contributions listener, so the server
   * answers it rather than the listener's view (ADR 0156).
   */
  private listContributions(household: LedgerHousehold, goalId: string): Promise<HouseholdContribution[]> {
    const [[genField]] = LEDGER_QUERY_SHAPES.contributionsByDate.fields;
    return this.firestore.getCollectionFromServer<HouseholdContribution>(
      `households/${household.id}/goals/${goalId}/contributions`,
      { where: [{ field: genField, op: '==', value: household.createdAt }] }
    );
  }

  private contributionDeletes(household: LedgerHousehold, goalId: string, contributions: readonly HouseholdContribution[]): BatchOp[] {
    return contributions.map(contribution => ({
      op: 'delete',
      path: `households/${household.id}/goals/${goalId}/contributions/${contribution.id}`
    }));
  }

  /**
   * Deletes what is left of a gone goal's contributions, listed afresh from
   * the server, in commits of HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK. Deleting
   * one already gone does nothing, so a sweep may run again at any time, and
   * its commits may go through the queue and land whenever they can.
   */
  private async sweepContributions(household: LedgerHousehold, goalId: string): Promise<void> {
    const left = await this.listContributions(household, goalId);
    for (const chunk of chunked(left, HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK)) {
      await this.firestore.commitBatch(this.contributionDeletes(household, goalId, chunk));
    }
  }

  /**
   * Sweeps a gone goal's contributions, never rejecting. One that did not
   * finish is kept for the next time the device is back online; a refusal
   * is not: the rules would refuse it again, and a membership that has ended
   * has no sweep left to make.
   */
  private async sweepOrKeep(household: LedgerHousehold, goalId: string): Promise<void> {
    const key = `${householdKey(household)}|${goalId}`;
    try {
      await this.sweepContributions(household, goalId);
      this.unswept.delete(key);
    } catch (error) {
      if (isRefused(error)) {
        this.unswept.delete(key);
        console.warn(`${LOG} A deleted goal's contributions were not all removed, and the rules refused the rest:`, error);
        return;
      }
      this.unswept.set(key, { household, goalId });
      console.warn(`${LOG} A deleted goal's contributions were not all removed; the rest go when the device is back online:`, error);
    }
  }

  /** Sweeps every gone goal whose contributions were not all removed, one at a time. */
  private async resumeSweeps(): Promise<void> {
    if (this.sweeping || this.destroyed || this.unswept.size === 0) return;
    this.sweeping = true;
    try {
      for (const { household, goalId } of [...this.unswept.values()]) {
        if (this.destroyed || !this.pwa.isOnline()) return;
        await this.sweepOrKeep(household, goalId);
      }
    } finally {
      this.sweeping = false;
    }
  }

  private idOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  /** A budget's fields as stored: every one on a create, only those given on an update. */
  private budgetFields(input: HouseholdBudgetChanges, mode: 'create' | 'update'): DocumentData {
    const data: DocumentData = {};
    if (mode === 'create' || input.name !== undefined) data['name'] = this.planName(input.name);
    if (mode === 'create' || input.categoryIds !== undefined) data['categoryIds'] = this.categoryIds(input.categoryIds);
    if (mode === 'create' || input.amount !== undefined) data['amount'] = this.requireAmount(input.amount);
    if (mode === 'create' || input.period !== undefined) {
      if (!isBudgetPeriod(input.period)) throw new Error('A household budget needs a period');
      data['period'] = input.period;
    }
    if (mode === 'create' || input.startDate !== undefined) data['startDate'] = this.stampOf(input.startDate);
    Object.assign(data, this.optional('endDate', input.endDate, mode, value => this.stampOf(value)));
    Object.assign(data, this.optional('alertThreshold', input.alertThreshold, mode, value => {
      if (!isAmount(value)) throw new Error('An alert threshold is a number');
      return value;
    }));
    if (mode === 'update' && input.isActive !== undefined) data['isActive'] = input.isActive === true;
    return data;
  }

  /** A goal's fields as stored: every one on a create, only those given on an update. */
  private goalFields(input: HouseholdGoalChanges, mode: 'create' | 'update'): DocumentData {
    const data: DocumentData = {};
    if (mode === 'create' || input.name !== undefined) data['name'] = this.planName(input.name);
    if (mode === 'create' || input.targetAmount !== undefined) data['targetAmount'] = this.requireAmount(input.targetAmount);
    Object.assign(data, this.optional('targetDate', input.targetDate, mode, value => this.stampOf(value)));
    if (mode === 'update' && input.isActive !== undefined) data['isActive'] = input.isActive === true;
    return data;
  }

  /**
   * An optional field: left out when not given; on a create, left out when
   * null too, and on an update, null removes it.
   */
  private optional<T>(field: string, value: T | null | undefined, mode: 'create' | 'update', stored: (value: T) => unknown): DocumentData {
    if (value === undefined) return {};
    if (value === null) return mode === 'update' ? { [field]: deleteField() } : {};
    return { [field]: stored(value) };
  }

  /** A name the rules accept once trimmed, as it is stored. */
  private planName(name: unknown): string {
    const clean = typeof name === 'string' ? name.trim() : '';
    if (clean.length < HOUSEHOLD_PLAN_NAME_LENGTH.min || clean.length > HOUSEHOLD_PLAN_NAME_LENGTH.max) {
      throw new HouseholdError(this.t('household.errors.planName', { max: HOUSEHOLD_PLAN_NAME_LENGTH.max }));
    }
    return clean;
  }

  /**
   * The categories a budget counts, each once in the order given, as many as
   * the rules accept, and each one a budget can count: a custom or income
   * category would be stored and count nothing.
   */
  private categoryIds(ids: unknown): string[] {
    const unique = Array.isArray(ids) ? [...new Set(ids)] : [];
    const valid = unique.length >= 1
      && unique.length <= HOUSEHOLD_PLAN_CATEGORY_MAX
      && unique.every(isHouseholdBudgetCategory);
    if (!valid) throw new HouseholdError(this.t('household.errors.planCategories', { max: HOUSEHOLD_PLAN_CATEGORY_MAX }));
    return unique as string[];
  }

  /** An amount the rules accept: a finite number above zero. */
  private requireAmount(amount: unknown): number {
    if (!isAmount(amount) || amount <= 0) throw new HouseholdError(this.t('household.errors.planAmount'));
    return amount;
  }

  /** An ISO 4217 code, as the currency picker gives. */
  private currencyCode(currency: unknown): string {
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new Error('A household plan needs a currency code');
    return currency;
  }

  private stampOf(date: unknown): Timestamp {
    if (!isDate(date)) throw new Error('A household plan date must be a valid date');
    return Timestamp.fromDate(date);
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.translation.t(key, params);
  }
}

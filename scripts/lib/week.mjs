/**
 * Where the bots' week sits against the real calendar.
 *
 * The seeder stakes a whole week in one command, outcomes included, at whatever
 * moment you happen to run it. That is fine for the days behind you and
 * nonsense for the days ahead: run it on a Monday evening and the Global feed —
 * the first screen a new account ever sees — announces that somebody finished
 * "Hike six miles with the dog on Saturday". Nobody has been to Saturday yet.
 *
 * So a day index is not just a label to sort by. It says whether an outcome is
 * possible at all, and that question has one answer for the whole run.
 */

/** Monday of the current week, in the server's own `week_start` shape. */
export function thisMonday(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // getDay(): Sunday is 0, so Monday is 1 and Sunday is six days into the week.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today as the app counts days: Monday is 0, Sunday is 6. */
export function todayIndex(now = new Date()) {
  return (now.getDay() + 6) % 7;
}

/**
 * A goal can only have been closed on a day that has actually happened.
 *
 * Today counts — a task staked for today can be done by the evening — so this
 * is `<=` rather than `<`. Everything after today is forced open no matter what
 * the model said, because no prompt wording makes a future outcome true.
 *
 * The side effect is worth naming: run the seeder early in the week and most of
 * the feed is open goals rather than closed ones. That is the honest picture,
 * and a better first screen than a cast who have already won the week — the
 * feed exists to show people staking things, not to be a pace car.
 */
export function possible(day, done, today) {
  return done === true && day <= today;
}

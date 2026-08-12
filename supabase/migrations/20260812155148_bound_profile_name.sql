-- A display name is now something a user chooses, not something the signup
-- trigger defaults to 'Someone'. That makes it the first string one account can
-- put on another account's screen — and, because the client persists the people
-- directory, on another account's disk.
--
-- The client's `peopleAreSound` rejects a restored payload holding a name longer
-- than 80, and rejection there is all-or-nothing: the staked week, the history,
-- the year grid and the streak go with it. So an unbounded name is not a layout
-- problem, it is one circle member able to wipe everyone else's device on their
-- next launch.
--
-- Bounded here as well as in the client because this is the only layer a client
-- cannot skip. `circles.name` was already bounded at 80 by
-- `circles_name_length`; this is the same number for the same reason.
--
-- The lower bound matters too: `name` is not-null but was free to be '', which
-- renders as a nameless row with '?' for initials.
alter table public.profiles
  add constraint profiles_name_length
  check (char_length(name) between 1 and 80);

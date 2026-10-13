/* ============================================================
   history.js - undo and redo for the builder.

   The whole plan is one plain JSON object and every edit to it
   already funnels through a single callback, so undo needs no new
   plumbing on the write path. It is a pair of stacks of snapshots.

   Two details decide whether this feels right or feels broken:

   1. Snapshots are taken *around* changes, not from them. changed()
      fires after the plan has already been mutated, so cloning there
      would store the new state and "undo" would be a no-op. Instead we
      keep the state as of the last step boundary and push that.

   2. Rapid edits collapse into one step. Dragging a photo, holding a
      colour picker or typing a sentence fires the callback many times
      in a second. Without coalescing, Ctrl+Z would walk back one
      character at a time and feel broken. Changes within COALESCE_MS
      of each other become a single undo step.

   Nothing here touches the DOM or the network. Restoring is handed back
   to the host through onRestore, because only the host knows how to
   re-render, re-save and re-preview.
   ============================================================ */
(function () {
  "use strict";

  var SS = window.SS || (window.SS = {});

  /* 50 steps is plenty for a session and keeps the memory bounded.
     A plan is a few tens of kB, so the ceiling is a few MB at worst. */
  var MAX_STEPS = 50;

  /* Long enough to gather a burst of edits, short enough that two
     deliberate actions stay separate steps. */
  var COALESCE_MS = 700;

  function clone(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (e) {
      return null;
    }
  }

  var History = {
    past: [],
    future: [],
    committed: null,     /* plan state as of the last step boundary */
    lastAt: 0,
    onRestore: null,

    /* Called once at boot, and whenever the project is replaced. */
    reset: function (plan) {
      History.past.length = 0;
      History.future.length = 0;
      History.committed = clone(plan);
      History.lastAt = 0;
      History.update();
    },

    /* Called after every mutation. */
    record: function (plan) {
      var now = Date.now();

      if (History.committed == null) {
        /* nothing to compare against yet */
        History.committed = clone(plan);
        History.lastAt = now;
        return;
      }

      /* A fresh step: remember where we were before it started. */
      if (now - History.lastAt > COALESCE_MS) {
        History.past.push(History.committed);
        if (History.past.length > MAX_STEPS) History.past.shift();
        /* a new edit invalidates anything we had undone */
        History.future.length = 0;
      }

      History.lastAt = now;
      History.committed = clone(plan);
      History.update();
    },

    canUndo: function () { return History.past.length > 0; },
    canRedo: function () { return History.future.length > 0; },

    undo: function (plan) {
      if (!History.past.length) return false;
      var target = History.past.pop();
      History.future.push(clone(plan));
      History.apply(plan, target);
      return true;
    },

    redo: function (plan) {
      if (!History.future.length) return false;
      var target = History.future.pop();
      History.past.push(clone(plan));
      History.apply(plan, target);
      return true;
    },

    /* The plan object is shared by reference with the editor, the
       preview frame and the save call. Reassigning Editor.plan would
       leave all of them holding the old object, so the new state is
       written into the existing one key by key instead. */
    apply: function (plan, target) {
      Object.keys(plan).forEach(function (key) { delete plan[key]; });
      Object.keys(target).forEach(function (key) { plan[key] = target[key]; });

      History.committed = clone(plan);
      /* The step just consumed. Reset the clock so the next real edit
         starts a new step rather than merging into this one. */
      History.lastAt = 0;

      if (History.onRestore) History.onRestore(plan);
      History.update();
    },

    /* Keeps the toolbar buttons' disabled state honest. */
    update: function () {
      var undo = document.getElementById("undoBtn");
      var redo = document.getElementById("redoBtn");
      if (undo) {
        undo.disabled = !History.canUndo();
        undo.setAttribute("aria-disabled", String(undo.disabled));
      }
      if (redo) {
        redo.disabled = !History.canRedo();
        redo.setAttribute("aria-disabled", String(redo.disabled));
      }
    }
  };

  SS.History = History;
  window.History = History;
})();
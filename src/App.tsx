import React from "react";
import logo from "./logo.svg";
import "./App.css";

import {
  createStore,
  U,
  createReducer,
  ActionsUnion,
  Effect,
  fromActions,
} from "@rxsv/core";
import * as R from "@devexperts/remote-data-ts";
import * as t from "io-ts";
import * as E from "fp-ts/es6/Either";
import * as O from "fp-ts/es6/Option";
import { pipe } from "fp-ts/es6/pipeable";
import { switchMap, map, pluck, catchError } from "rxjs/operators";
import { ajax } from "rxjs/ajax";
import { of, Observable } from "rxjs";
import { useObservableState } from "observable-hooks";

const BeersAction = U.createUnion(
  U.caseOf("FETCH_BEERS_STARTED")(),
  U.caseOf("FETCH_BEERS_FAILED")<Error>(),
  U.caseOf("FETCH_BEERS_FINISHED")<Beers>()
);
type BeersAction = ActionsUnion<typeof BeersAction>;

const Beer = t.type({
  id: t.number,
  name: t.string,
  tagline: t.string,
  first_brewed: t.string, // use date codec
  description: t.string,
  image_url: t.string,
});
type Beer = t.TypeOf<typeof Beer>;

const Beers = t.array(Beer);
type Beers = t.TypeOf<typeof Beers>;

type BeersState = R.RemoteData<Error, Beers>;

const beersReducer = createReducer<BeersState>(R.initial)<BeersAction>({
  FETCH_BEERS_STARTED: () => R.pending,
  FETCH_BEERS_FAILED: (_state, { payload }) => R.failure(payload),
  FETCH_BEERS_FINISHED: (_state, { payload }) => R.success(payload),
});

type AppEffect = Effect<BeersAction, BeersState>;

const fetchBeers = (): Observable<E.Either<Error, Beers>> =>
  ajax("https://api.punkapi.com/v2/beers").pipe(
    pluck("response"),
    map(Beers.decode),
    map(E.mapLeft((e) => new Error(e.toString()))),
    catchError((err) => of(E.left(err)))
  );

const beersEffect: AppEffect = (action$) =>
  action$.pipe(
    fromActions(BeersAction.FETCH_BEERS_STARTED),
    switchMap(fetchBeers),
    map(
      E.fold<Error, Beers, BeersAction>(
        BeersAction.FETCH_BEERS_FAILED,
        BeersAction.FETCH_BEERS_FINISHED
      )
    )
  );

const beersStore = createStore(beersReducer, beersEffect);

function App() {
  const beers = useObservableState(beersStore.state$);

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Edit <code>src/App.tsx</code> and save to reload.
        </p>
        <div>
          {pipe(
            beers,
            O.fromNullable,
            O.getOrElse<BeersState>(() => R.failure(new Error("sub err"))),
            R.fold(
              () => "initial",
              () => "pending",
              () => "failure",
              (s) => JSON.stringify(s)
            )
          )}
        </div>
        <button
          onClick={() =>
            beersStore.action$.next(BeersAction.FETCH_BEERS_STARTED())
          }
        >
          fetch
        </button>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
      </header>
    </div>
  );
}

export default App;

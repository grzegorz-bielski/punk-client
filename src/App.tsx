import React, { useCallback } from 'react';
import './App.css';
import { Router, Route, Link, useLocation } from 'react-router-dom';
import * as H from 'history';

import { createStore, U, createReducer, ActionsUnion, Effect, fromActions } from '@rxsv/core';
import { withDevTools } from '@rxsv/tools';
import * as RD from '@devexperts/remote-data-ts';
import * as R from 'fp-ts/es6/Record';
import * as O from 'fp-ts/es6/Option';
import * as S from 'fp-ts/es6/Semigroup';
import * as A from 'fp-ts/es6/Array';
import * as t from 'io-ts';
import * as E from 'fp-ts/es6/Either';
import { pipe } from 'fp-ts/es6/pipeable';
import { switchMap, map, pluck, catchError, startWith, distinctUntilChanged, filter } from 'rxjs/operators';
import { ajax } from 'rxjs/ajax';
import { of, Observable, merge } from 'rxjs';
import { useObservableState } from 'observable-hooks';

const BeersAction = U.createUnion(
  U.caseOf('FETCH_BEERS_STARTED')<{ perPage: number; page: number }>(),
  U.caseOf('FETCH_BEERS_FAILED')<Error>(),
  U.caseOf('FETCH_BEERS_FINISHED')<Beers>(),
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

type BeersState = RD.RemoteData<Error, Record<Beer['name'], Beer>>;

const zip = <T,>() => R.fromFoldableMap(S.getLastSemigroup<T>(), A.array);

const beersReducer = createReducer<BeersState>(RD.initial)<BeersAction>({
  FETCH_BEERS_STARTED: () => RD.pending,
  FETCH_BEERS_FAILED: (_state, { payload }) => RD.failure(payload),
  FETCH_BEERS_FINISHED: (state, { payload }) => {
    const loaded = zip<Beer>()(payload, b => [b.name, b]);

    // todo: keep pages in state, use cached beers from prev pages

    // const monoid = <T extends object>() => R.getMonoid(S.getObjectSemigroup<T>());
    // return pipe(
    //   state,
    //   RD.map(beers => monoid<Beer>().concat(beers, loaded)),
    //   RD.getOrElse(() => loaded),
    //   RD.success,
    // );

    return pipe(RD.success(loaded));
  },
});

type AppEffect = Effect<BeersAction, BeersState>;

type FetchBeers = (o: { perPage: number; page: number }) => Observable<E.Either<Error, Beers>>;
const fetchBeers: FetchBeers = ({ perPage, page }) =>
  ajax(`https://api.punkapi.com/v2/beers?per_page=${perPage}&page=${page}`).pipe(
    pluck('response'),
    map(Beers.decode),
    map(E.mapLeft(e => new Error(e.toString()))),
    catchError(err => of(E.left(err))),
  );

const getPageFromSearch = (l: H.Location) =>
  pipe(
    O.fromNullable(new URLSearchParams(l.search).get('page')),
    O.chain(n => O.tryCatch(() => Number.parseInt(n, 10))),
  );

const fromURL = (history: H.History) =>
  new Observable<H.Location>(ob => history.listen(ob.next.bind(ob))).pipe(startWith(history.location));

const createBeersEffect = (history: H.History): AppEffect => action$ => {
  const url$ = fromURL(history);
  const beersPage$ = url$.pipe(
    filter(a => a.pathname.startsWith('/beers')),
    map(getPageFromSearch),
    map(O.getOrElse(() => 1)),
    distinctUntilChanged(),
    map(page => BeersAction.FETCH_BEERS_STARTED({ perPage: 25, page })),
  );

  return merge(
    beersPage$,
    action$.pipe(
      fromActions(BeersAction.FETCH_BEERS_STARTED),
      pluck('payload'),
      switchMap(fetchBeers),
      map(E.fold<Error, Beers, BeersAction>(BeersAction.FETCH_BEERS_FAILED, BeersAction.FETCH_BEERS_FINISHED)),
    ),
  );
};

const history = H.createBrowserHistory();

const beersStore = withDevTools(createStore(beersReducer, createBeersEffect(history)));

const useBeers = () => {
  const location = useLocation();
  const beers = useObservableState(beersStore.state$, RD.initial);
  const fetchBeers = useCallback(
    (page: number) => () => beersStore.action$.next(BeersAction.FETCH_BEERS_STARTED({ perPage: 25, page })),
    [],
  );

  const currentPage = pipe(location, getPageFromSearch);
  const nextPage = pipe(
    currentPage,
    O.map(n => n + 1),
    O.getOrElse(() => 2),
  );

  return { beers, fetchBeers, currentPage, nextPage };
};

const BeersCatalog = () => {
  const { beers, nextPage } = useBeers();

  return (
    <div>
      <Link className="button is-primary is-large" to={`/beers?page=${nextPage}`}>
        next
      </Link>
      {pipe(
        beers,
        RD.fold(
          () => <h2>Click fetch to start</h2>,
          () => <h2>Loading...</h2>,
          e => <h2>{e.message}</h2>,
          beers => (
            <ul className="container">
              <h2 className="title">Beers</h2>
              {pipe(
                beers,
                R.collect((_k, beer) => (
                  <li key={beer.id}>
                    <div>
                      <h3 className="subtitle">{beer.name}</h3>
                      <p>
                        <span>{beer.tagline}</span>
                        <span>{beer.first_brewed}</span>
                      </p>
                      <p>{beer.description}</p>
                      <img src={beer.image_url} alt={`A bottle of the ${beer.name}`}></img>
                    </div>
                  </li>
                )),
              )}
            </ul>
          ),
        ),
      )}
    </div>
  );
};

export const App = () => (
  <Router history={history}>
    <div className="App">
      <header className="App-header">
        <section className="section">
          <Route path="/:id">
            <BeersCatalog />
          </Route>
        </section>
      </header>
    </div>
  </Router>
);

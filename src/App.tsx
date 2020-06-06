import React, { useCallback } from 'react';
import './App.css';
import { Router, Route, Link, useLocation, Redirect } from 'react-router-dom';
import * as H from 'history';
import styled from 'styled-components';

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
  const beers = useObservableState(beersStore.state$, RD.initial);
  const fetchBeers = useCallback(
    (page: number) => () => beersStore.action$.next(BeersAction.FETCH_BEERS_STARTED({ perPage: 25, page })),
    [],
  );

  return { beers, fetchBeers };
};

const usePagination = () => {
  const location = useLocation();
  const currentPage = pipe(location, getPageFromSearch);
  const nextPage = pipe(
    currentPage,
    O.map(n => n + 1),
    O.getOrElse(() => 2),
  );

  return { currentPage, nextPage };
};

const BeersCatalog = () => {
  const { beers } = useBeers();

  return (
    <div>
      {pipe(
        beers,
        RD.fold(
          () => <h2>Click fetch to start</h2>,
          () => <h2>Loading...</h2>,
          e => <h2>{e.message}</h2>,
          beers => (
            <div className="container">
              <CatalogPage className="container">
                {pipe(
                  beers,
                  R.collect((_k, beer) => (
                    <li key={beer.id} className="card">
                      <div className="card-content">
                        <header className="level">
                          <h3 className="card-header-title">
                            {beer.name}, {beer.tagline}
                          </h3>
                          <p className="subtitle">{beer.first_brewed}</p>
                        </header>
                        <div className="card-content level">
                          <Label src={beer.image_url} alt={`A bottle of the ${beer.name}`} />
                          <p className="content">{beer.description}</p>
                        </div>
                      </div>
                    </li>
                  )),
                )}
              </CatalogPage>
            </div>
          ),
        ),
      )}
    </div>
  );
};

const CatalogPage = styled.ul`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(30rem, 1fr));
  grid-gap: 1rem;
`;

const Label = styled.img`
  object-fit: contain;
  max-width: 4rem;

  margin-right: 3rem;
`;

const Navigation: React.FC = () => {
  const { nextPage } = usePagination();

  return (
    <Link className="button is-primary" to={`/beers?page=${nextPage}`}>
      next page
    </Link>
  );
};

export const App = () => (
  <Router history={history}>
    <div>
      <header>
        <nav className="navbar is-fixed-bottom has-shadow" role="navigation" aria-label="main navigation">
          <div className="container is-fullhd">
            <NavItems>
              <div>
                <Link to="/beers" className="title is-primary">
                  DIY 🐶
                </Link>
              </div>

              <div>
                <Navigation />
              </div>
            </NavItems>
          </div>
        </nav>
      </header>
      <main className="section">
        <Route path="/:id">
          <BeersCatalog />
        </Route>
        <Route path="/" exact>
          <Redirect to="/beers" />
        </Route>
      </main>
    </div>
  </Router>
);

const NavItems = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 0.75rem;
`;

/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

function init() {

    $ui.register((ctx) => {
        //#region States
        const pickedForYou = ctx.state<PickedForYou[]>([]);
        const currentPage = ctx.state<number>(1);
        const recommendationsPerPage = ctx.state<number>(6);
        const storageSettings = ctx.state<StorageSettings>({ numberOfRecommendations: 15, recommendationsProvider: "anilist", daysBeforeRefreshing: 1 });
        const selectedGenre = ctx.state<string | undefined>(undefined);
        const isFilterOpen = ctx.state<boolean>(false);
        //#endregion

        //#region Constants
        const settingsEvent = `settings_${new Date().getTime()}`;
        const saveSettings = `onSaveSettings_${new Date().getTime()}`;
        const cancelSettings = `onCancel_${new Date().getTime()}`;
        const openFiltersDiv = `onOpenFiltersDiv_${new Date().getTime()}`;
        const defaultRecommendationsAmount: number = 15;
        const defaultRecommendationsRefresh: number = 1;
        const defaultRecommendationsProvider: string = 'anilist';
        const numbersRegex = /\D.*$/gi;
        //#endregion

        //#region Field References
        const numberOfRecommendationsRef = ctx.fieldRef<string>();
        const daysBeforeRefreshingRef = ctx.fieldRef<string>();
        const recommendationsPerPageRef = ctx.fieldRef<string>();
        const recommendationsProviderRef = ctx.fieldRef<string>();
        const filterByGenreRef = ctx.fieldRef<string>();
        //#endregion

        //#region Storage Keys
        const settingsStorageKey = 'settings';
        const recommendationsStorageKey = 'recommendations';
        //#endregion

        const tray = ctx.newTray({
            iconUrl: 'https://raw.githubusercontent.com/kRYstall9/Picked-For-You/refs/heads/main/src/icons/recommendedicon.png',
            withContent: true,
            width: '650px'
        });

        //#region Events
        ctx.registerEventHandler(settingsEvent, () => {

            const settings = $storage.get(settingsStorageKey);
            storageSettings.set(settings);

            tray.render(() => {
                return settingsLayout();
            })
            tray.update();
        });

        ctx.registerEventHandler(saveSettings, () => {

            try {
                const dbSettings = $storage.get<StorageSettings>(settingsStorageKey);
                const settings = storageSettings.get();
                const days = settings.daysBeforeRefreshing;

                if (dbSettings?.daysBeforeRefreshing != days ||
                    dbSettings.numberOfRecommendations != settings.numberOfRecommendations ||
                    dbSettings.recommendationsProvider != settings.recommendationsProvider
                ) {
                    if (dbSettings?.daysBeforeRefreshing != days) {
                        const refreshingOn = addDays(new Date(), days);

                        storageSettings.set({
                            ...settings,
                            nextRefresh: days == 0 ? null : refreshingOn
                        });

                        if (days != 0) {
                            ctx.toast.info(`Recommendations will be cached until ${storageSettings.get().nextRefresh}`);
                        }
                        else {
                            $storage.remove(recommendationsStorageKey);
                        }
                    }

                    $storage.set(settingsStorageKey, storageSettings.get());
                    ctx.toast.success('Settings saved');
                    getPickedForYou();
                }

                tray.render(() => getFinalContainer());
                tray.update();
            }
            catch (error: any) {
                createLogMessage('error', 'saveSettings', error);
                ctx.toast.error('An error occured on saving settings. Check the logs for more information');
            }

        });

        ctx.registerEventHandler(cancelSettings, () => {
            tray.render(() => getFinalContainer());
            tray.update();
        });

        ctx.registerEventHandler(openFiltersDiv, () => {
            isFilterOpen.set((prev) => !prev);
        })

        numberOfRecommendationsRef.onValueChange((value) => {
            const updatedValue = parseInt(value.replace(numbersRegex, ''), 10);

            if (value == '' || isNaN(updatedValue)) {
                numberOfRecommendationsRef.setValue('');
                storageSettings.set((prev) => ({ ...prev, numberOfRecommendations: -1 }));
                return;
            }

            numberOfRecommendationsRef.setValue(updatedValue.toString());
            storageSettings.set((prev) => ({ ...prev, numberOfRecommendations: updatedValue }));
        });

        daysBeforeRefreshingRef.onValueChange((value) => {
            const updatedValue = parseInt(value.replace(numbersRegex, ''), 10);

            if (value == '' || isNaN(updatedValue)) {
                daysBeforeRefreshingRef.setValue('');
                storageSettings.set((prev) => ({ ...prev, daysBeforeRefreshing: -1 }));
                return;
            }

            daysBeforeRefreshingRef.setValue(updatedValue.toString());
            storageSettings.set((prev) => ({ ...prev, daysBeforeRefreshing: updatedValue }));
        });

        recommendationsProviderRef.onValueChange((value) => {
            storageSettings.set((prev) => ({ ...prev, recommendationsProvider: value as "anilist" | "sprout" }));
        })

        filterByGenreRef.onValueChange((value) => {
            currentPage.set(1);
            selectedGenre.set(value);
        });

        tray.onOpen(async () => {
            await getPickedForYou();
        })

        //#endregion

        //#region Functions
        async function getPickedForYou() {

            const dbSettings = $storage.get(settingsStorageKey) || undefined;
            const savedRecommendations = $storage.get(`${recommendationsStorageKey}.${storageSettings.get().recommendationsProvider}`) || [];

            if (dbSettings != undefined) {
                storageSettings.set(dbSettings);
            }
            else
                return;

            if (storageSettings.get().daysBeforeRefreshing != 0 && savedRecommendations.length > 0) {

                createLogMessage('debug', 'getPickedForYou', 'Days Before Refreshing is not 0');

                const now = new Date();
                const nextRefresh = storageSettings.get().nextRefresh;
                const dateSaved = nextRefresh ? new Date(nextRefresh.toString()) : new Date();

                const difference = daysBetween(dateSaved, now);

                if (difference < storageSettings.get().daysBeforeRefreshing) {
                    const animes = $storage.get(`${recommendationsStorageKey}.${storageSettings.get().recommendationsProvider}`);
                    pickedForYou.set(animes);
                    return;
                }
                createLogMessage('debug', 'getPickedForYou', 'Refreshing');
                storageSettings.set((prev) => ({ ...prev, nextRefresh: addDays(now, storageSettings.get().daysBeforeRefreshing) }));
                $storage.set(settingsStorageKey, storageSettings.get());
            }

            const chosenProvider = storageSettings.get().recommendationsProvider;
            const animes: PickedForYou[] = [];
            const token = $database.anilist.getToken();

            if (chosenProvider == 'anilist') {

                const userAnimes = $anilist.getAnimeCollection(false);
                const completedOrWatchingAnimes = userAnimes.MediaListCollection?.lists?.filter(x => x.status == "COMPLETED" || x.status == "CURRENT").flatMap(x => x.entries) ?? [];
                const completedOrWatchingAnimesIds = completedOrWatchingAnimes.map(x => x?.media?.id);
                const watchedAnimes: any = {};

                for (let completedAnime of completedOrWatchingAnimes) {
                    const genres = completedAnime?.media?.genres;
                    for (let genre of genres ?? []) {
                        try {
                            if (!(genre in watchedAnimes) || (Object.keys(watchedAnimes).length == 0)) {
                                watchedAnimes[genre] = 1
                            }
                            else {
                                watchedAnimes[genre] = watchedAnimes[genre] + 1;
                            }
                        }
                        catch (error) {
                            console.error(error);
                        }
                    }
                }

                const top3 = Object.entries(watchedAnimes)
                    .sort((a: any, b: any) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([genre, count]) => genre);

                const query = `query Media($genreIn: [String], $perPage: Int, $sort: [MediaSort], $idNotIn: [Int]) {
                                    Page(perPage: $perPage) {
                                        media(genre_in: $genreIn, sort: $sort, id_not_in: $idNotIn, type: ANIME) {
                                        title {
                                            english
                                            romaji
                                        }
                                        coverImage {
                                            medium
                                        }
                                        id
                                        genres
                                        }
                                    }
                                }`;


                const variables = {
                    genreIn: top3,
                    perPage: storageSettings.get().numberOfRecommendations,
                    sort: 'SCORE_DESC',
                    idNotIn: completedOrWatchingAnimesIds
                };

                const response = $anilist.customQuery({
                    query: query,
                    variables: variables,
                }, token);

                for (let anime of response.Page.media) {
                    animes.push({
                        coverImage: anime.coverImage.medium ?? '',
                        title: anime.title.english ?? anime.title.romaji,
                        id: anime.id,
                        genres: anime.genres
                    });
                }
            }
            else {
                try {
                    const sproutAnimes: PickedForYou[] = [];
                    const anilistUserName = $database.anilist.getUsername();
                    const response = await fetch(`https://anime.ameo.dev/user/${anilistUserName}/recommendations/__data.json?source=anilist`);
                    if (!response.ok) {
                        createLogMessage('error', 'getPickerForYou', `An error occured while retrieving data from Sprout. ERROR: ${response.statusText}`);
                        return;
                    }

                    const json = response.json();

                    Object.keys(json.initialRecommendations.animeData).forEach(key => {
                        const animeData = json.initialRecommendations.animeData[key];
                        const title = animeData.title;
                        const coverImage = animeData['main_picture']['medium'];
                        const id = animeData['id'];
                        const genres = animeData['genres'].map(genre => genre.name);

                        sproutAnimes.push({
                            title: title,
                            genres: genres,
                            id: id,
                            coverImage: coverImage
                        });
                    });

                    const malIds = sproutAnimes.map(x => x.id);
                    const query = `query Media($perPage: Int, $idMalIn: [Int]) {
                                    Page(perPage: $perPage) {
                                        media(idMal_in: $idMalIn, type: ANIME) {
                                        id
                                        idMal
                                        }
                                    }
                                }`;
                    const variables = {
                        idMalIn: malIds,
                        perPage: sproutAnimes.length
                    };

                    const anilistResponse = $anilist.customQuery({
                        query: query,
                        variables: variables
                    }, token);

                    for (let sproutAnime of sproutAnimes) {
                        const found = anilistResponse.Page.media.find(anilistIds => anilistIds.idMal == sproutAnime.id);
                        if (found) {
                            animes.push({
                                ...sproutAnime,
                                id: found.id
                            });
                        }
                    }
                }
                catch (error) {
                    createLogMessage('error', 'getPickerForYou', error);
                }
            }

            pickedForYou.set(animes);

            if (storageSettings.get().nextRefresh != null) {
                createLogMessage('debug', 'getPickedForYou', 'Saving recommendations to the storage');
                $storage.set(`${recommendationsStorageKey}.${storageSettings.get().recommendationsProvider}`, pickedForYou.get());
            }
        }

        function getRecommendationsContainers(recommendations: PickedForYou[], itemsPerPage: number, pageNumber: number, genre?: string) {
            let items: any = [];

            const shows = getPaginatedItems(recommendations, itemsPerPage, pageNumber, genre);


            for (let anime of shows) {
                const animeEvent = `onClick_${anime.title}`;

                ctx.registerEventHandler(animeEvent, () => {
                    ctx.screen.navigateTo('/entry', { id: anime.id.toString() })
                });

                items.push(
                    tray.div({
                        items: [
                            tray.div({
                                items: [
                                    tray.div({
                                        items: [],
                                        style: {
                                            backgroundImage: `url(${anime.coverImage ?? ''})`,
                                            backgroundSize: 'contain',
                                            backgroundPosition: 'center',
                                            backgroundRepeat: 'no-repeat',
                                            width: '100%',
                                            minHeight: '150px',
                                        },
                                        className: 'relative cursor-pointer opacity-50'
                                    }),
                                    tray.button({
                                        label: 'watch',
                                        className: 'absolute inset-0 w-full h-full bg-transparent hover:bg-gray-500 z-10 transition-colors duration-300',
                                        onClick: animeEvent
                                    })

                                ],
                                className: 'relative'
                            }),
                            tray.text(anime.title, { className: 'text-sm font-semibold text-center line-clamp-2 break-normal' })
                        ],
                    })
                );
            }

            return tray.div({
                items: [items],
                className: 'grid grid-cols-2 sm:grid-cols-3 gap-4'
            });
        }

        function header(pageName: string, isHomepage: boolean = true) {
            const buttons: any = [];
            if (isHomepage) {
                buttons.push(
                    tray.div({
                        items: [
                            tray.button({
                                label: '⚙️',
                                intent: 'primary',
                                onClick: settingsEvent,
                                className: 'text-xs',
                            })
                        ],
                        className: 'flex gap-2'
                    })
                );
            }

            return tray.div({
                items: [
                    tray.div({
                        items: [
                            tray.text(pageName, { className: 'font-bold text-lg' }),
                            ...buttons
                        ],
                        className: 'flex flex-row content-between items-center',
                    }),
                    tray.div({
                        items: [],
                        className: 'w-1/2 border-b border-2 self-center rounded mt-2 mb-4',
                    }),
                ],
                className: 'flex flex-col'
            })
        }

        function createLogMessage(logLevel: LogLevel, method: string, msg: any) {

            console[logLevel](`[${logLevel.toString().toUpperCase()}] - [${method}] - ${msg}`);
        }

        function pagination(tray: $ui.Tray, itemsPerPage: number, genre?: string) {

            const recommendations = (genre != null && genre != 'all') ? pickedForYou.get().filter(x=> x.genres.includes(genre)) : pickedForYou.get();

            const totalEpisodesWatched = recommendations.length;
            const totalPages = Math.floor(totalEpisodesWatched / itemsPerPage) + (totalEpisodesWatched % itemsPerPage > 0 ? 1 : 0);
            const pageGroup = 3;
            const pages: any = [];

            const startPage = Math.max(1, currentPage.get() - 1);
            const endPage = Math.min(totalPages, startPage + pageGroup - 1);

            for (let pageNumber = startPage; pageNumber <= endPage; pageNumber++) {
                const updatePage = `update_${pageNumber}`;

                ctx.registerEventHandler(updatePage, () => {
                    if (currentPage.get() === pageNumber) {
                        return;
                    }

                    createLogMessage('debug', 'pagination', `Page requested: ${pageNumber}`);
                    currentPage.set(pageNumber);
                })

                pages.push(
                    tray.button({
                        label: (pageNumber).toString(),
                        size: 'sm',
                        intent: currentPage.get() == (pageNumber) ? "primary" : "gray",
                        onClick: updatePage
                    }
                    ));
            }

            const previousPage = `previousePage${new Date().getTime()}`;
            const nextPage = `nextPage${new Date().getTime()}`;
            const firstPage = `firstPage${new Date().getTime()}`;
            const lastPage = `lastPage${new Date().getTime()}`;


            ctx.registerEventHandler(previousPage, () => {
                const prevPageNumber = currentPage.get();

                if (prevPageNumber <= 1) {
                    return;
                }

                currentPage.set(prevPageNumber - 1);

            })

            ctx.registerEventHandler(nextPage, () => {
                const currentPageNumber = currentPage.get();

                if (currentPageNumber >= totalPages) {
                    return;
                }

                currentPage.set(currentPageNumber + 1);
            })

            ctx.registerEventHandler(firstPage, () => {
                currentPage.set(1);
            })

            ctx.registerEventHandler(lastPage, () => {
                currentPage.set(totalPages);
            })

            recommendationsPerPageRef.onValueChange((value) => {
                const currentValue = parseInt(value, 10);

                if (!isNaN(currentValue)) {
                    recommendationsPerPage.set(currentValue);
                    //Reset page number to 1
                    currentPage.set(1);
                }
            })

            const buttonsStyle = 'w-8 h-8 flex items-center justify-center text-xs';

            return tray.div({
                items: [
                    tray.div({
                        items: [
                            tray.button({
                                label: '<<',
                                disabled: currentPage.get() <= 1,
                                onClick: firstPage,
                                className: buttonsStyle
                            }),
                            tray.button({
                                label: '<',
                                disabled: currentPage.get() <= 1,
                                onClick: previousPage,
                                className: buttonsStyle
                            }),
                            ...pages,
                            tray.button({
                                label: '>',
                                disabled: currentPage.get() >= totalPages,
                                onClick: nextPage,
                                className: buttonsStyle
                            }),
                            tray.button({
                                label: '>>',
                                disabled: currentPage.get() >= totalPages,
                                onClick: lastPage,
                                className: buttonsStyle
                            })
                        ],
                        className: 'gap-1 hidden sm:flex'
                    }),
                    tray.div({
                        items: [
                            tray.button({
                                label: '<',
                                disabled: currentPage.get() <= 1,
                                onClick: previousPage,
                                className: buttonsStyle
                            }),
                            tray.button({
                                label: '>',
                                disabled: currentPage.get() >= totalPages,
                                onClick: nextPage,
                                className: buttonsStyle
                            }),
                        ],
                        className: 'gap-1 flex items-end sm:hidden'
                    }),
                    tray.div({
                        items: [
                            tray.text('Items per page', {
                                className: 'font-bold text-xs'
                            }),
                            tray.select({
                                label: '',
                                options: [
                                    { label: '6', value: '6' },
                                    { label: '15', value: '15' },
                                    { label: '30', value: '30' },
                                ],
                                size: 'sm',
                                fieldRef: recommendationsPerPageRef,
                                value: recommendationsPerPage.get().toString(),
                            })
                        ],
                        className: 'flex flex-col sm:flex-row gap-1 w-auto items-center whitespace-nowrap'
                    })
                ],
                className: 'flex justify-between mt-4'
            });
        }

        function getPaginatedItems(recommendations: PickedForYou[], itemsPerPage: number, pageNumber: number, genre?: string) {

            //Page 1 , partire da index 0 -> max  index 4
            //Page 2, partire da index 5 -> max index 9 -> max index = (itemsPerPage * pageNumber) - 1  / min index = (itemsPerPage * (pageNumber-1))
            let minIndex = 0;
            let maxIndex = 0;

            if (pageNumber > 1) {
                minIndex = itemsPerPage * (pageNumber - 1);
            }

            maxIndex = (itemsPerPage * pageNumber);

            if (genre != null && genre != 'all') {
                const items = recommendations.filter(x => x.genres.includes(genre)).slice(minIndex, maxIndex);
                return items;
            }

            return recommendations.slice(minIndex, maxIndex);
        }

        function settingsLayout(isSetup: boolean = false) {

            return tray.div({
                items: [
                    header(`${isSetup ? 'Setup' : 'Settings'}`, false),
                    tray.div({
                        items: [
                            tray.div({
                                items: [
                                    tray.input({
                                        label: `Days before refreshing recommendations - 0 = Always refresh (Default: ${defaultRecommendationsRefresh})`,
                                        value: storageSettings.get().daysBeforeRefreshing.toString(),
                                        className: 'font-semibold',
                                        fieldRef: daysBeforeRefreshingRef
                                    }),
                                    tray.text('Insert values >= 0', { className: 'text-xs', style: { 'display': `${(storageSettings.get().daysBeforeRefreshing == -1) ? 'block' : 'none'}`, 'color': 'red' } }),
                                ],
                                className: 'flex flex-col items-start'
                            }),
                            tray.div({
                                items: [
                                    tray.input({
                                        label: `Number of recommendations to show - (Default: ${defaultRecommendationsAmount})`,
                                        value: storageSettings.get().numberOfRecommendations?.toString(),
                                        className: `font-semibold ${storageSettings.get().recommendationsProvider == 'sprout' ? 'hidden' : 'block'}`,
                                        fieldRef: numberOfRecommendationsRef
                                    }),
                                    tray.text('Insert values >= 0', { className: 'text-xs', style: { 'display': `${(storageSettings.get().numberOfRecommendations == -1) ? 'block' : 'none'}`, 'color': 'red' } }),
                                ],
                                className: 'flex flex-col items-start'
                            }),
                            tray.div({
                                items: [
                                    tray.select({
                                        label: `Recommendations Provider - (Default: ${defaultRecommendationsProvider})`,
                                        options: [
                                            { label: 'anilist', value: 'anilist' },
                                            { label: 'sprout', value: 'sprout' },
                                        ],
                                        fieldRef: recommendationsProviderRef,
                                        value: storageSettings.get().recommendationsProvider,
                                        className: 'font-semibold'
                                    })
                                ]
                            })
                        ],
                        className: 'flex flex-col mb-4 gap-4'
                    }),
                    tray.div({
                        items: [
                            tray.button({
                                label: 'Save',
                                intent: 'primary',
                                className: `text-sm ${isSetup ? 'w-full' : 'w-1/2'}`,
                                onClick: saveSettings,
                                disabled: ((storageSettings.get().numberOfRecommendations ?? 0) <= 0) || ((storageSettings.get().daysBeforeRefreshing ?? 0) < 0)
                            }),
                            tray.button({
                                label: 'Cancel',
                                intent: 'primary-subtle',
                                className: 'text-sm w-1/2',
                                onClick: cancelSettings,
                                style: { 'display': `${isSetup ? 'none' : 'block'}` }
                            })
                        ],
                        className: 'flex gap-2'
                    })
                ],
                className: 'container flex flex-col content-center m-0 p-0'
            })
        }

        function daysBetween(date1: Date, date2: Date): number {
            const oneDayMs = 1000 * 60 * 60 * 24; // daily ms
            const diffMs = Math.abs(date2.getTime() - date1.getTime()); // ms difference
            return Math.floor(diffMs / oneDayMs);
        }

        function addDays(date: Date, daysToAdd: number): Date {

            const result = new Date(date);
            result.setDate(result.getDate() + daysToAdd);

            return result;
        }

        function createFilters(recommendations: PickedForYou[]) {
            const items: any = [];

            const genres = new Set<string>();

            recommendations.forEach(recommendation => {
                recommendation.genres.forEach(genre => {
                    genres.add(genre);
                })
            });

            const genresArray = Array.from(genres).map(genre => ({ label: genre, value: genre }));

            return tray.div({
                items: [
                    tray.div({
                        items: [
                            tray.div({
                                items: [
                                    tray.button({
                                        label: `🔍 Filters ${isFilterOpen.get() ? '△' : '▽'}`,
                                        intent: 'primary-subtle',
                                        onClick: openFiltersDiv,
                                        className: 'text-sm',
                                    }),
                                ],
                                className: 'flex justify-center items-center'
                            }),
                            tray.div({
                                items: [
                                    ...(isFilterOpen.get() ? [
                                        tray.select({
                                            label: 'Genre',
                                            options: [
                                                { label: 'All', value: 'all' },
                                                ...genresArray
                                            ],
                                            className: `text-sm`,
                                            fieldRef: filterByGenreRef,
                                            value: selectedGenre.get() || ''
                                        })
                                    ] : []
                                    )

                                ],
                                className: `relative ${isFilterOpen.get() == true ? 'block' : 'hidden'} grid grid-cols-3`,
                            }),
                        ],
                        className: 'relative'
                    })
                ],
                className: `mb-4 ${pickedForYou.get().length > 0 ? 'block' : 'hidden'}`
            })



        }

        function getFinalContainer() {
            const dbSettings = $storage.get(settingsStorageKey) || undefined;
            let finalItem: any;

            if (dbSettings == undefined || Object.keys(dbSettings).length === 0) {
                try {
                    finalItem = tray.div({
                        items: [
                            settingsLayout(true)
                        ],
                    });
                }
                catch (error: any) {
                    createLogMessage('error', 'Get settings from db', error);
                }
            }
            else {
                storageSettings.set(dbSettings);

                finalItem = tray.div({
                    items: [
                        header('Picked For You'),
                        createFilters(pickedForYou.get()),
                        getRecommendationsContainers(pickedForYou.get(), recommendationsPerPage.get(), currentPage.get(), selectedGenre.get()),
                        pagination(tray, recommendationsPerPage.get(), selectedGenre.get())
                    ],
                    className: 'container flex flex-col content-center m-0 p-0'
                });
            }
            return finalItem;
        }

        //#endregion

        tray.render(() => getFinalContainer());
    });
}

type PickedForYou = {
    title: string;
    coverImage?: string;
    id: number;
    genres: string[]
}

type LogLevel = "error" | "warn" | "info" | "debug";

type StorageSettings = {
    numberOfRecommendations?: number | null;
    recommendationsProvider: "anilist" | "sprout";
    daysBeforeRefreshing: number;
    nextRefresh?: Date | null
}

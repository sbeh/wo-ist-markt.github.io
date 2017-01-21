/*
 * © Code for Karlsruhe and contributors.
 * See the file LICENSE for details.
 */

var TILES_URL = '//cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png';
var ATTRIBUTION = 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> ' +
                  'contributors, <a href="http://creativecommons.org/licenses/by-sa/2.0/">' +
                  'CC-BY-SA</a>. Tiles &copy; <a href="http://cartodb.com/attributions">' +
                  'CartoDB</a>';

var DEFAULT_CITY_ID = "karlsruhe";
var CITY_LIST_API_URL = 'cities/cities.json';
var cityDirectory = {}; // the city directory (i.e. a list of all cities indexed by id)

var map;
var nowGroup = L.layerGroup();
var todayGroup = L.layerGroup();
var otherGroup = L.layerGroup();
var unclassifiedGroup = L.layerGroup();

var now = new Date();
var TIME_NOW = [now.getHours(), now.getMinutes()];
var DAY_INDEX = (now.getDay() + 6) % 7;  // In our data, first day is Monday
var DAY_NAMES_GERMAN = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
var DEFAULT_MARKET_TITLE = 'Markt';

L.AwesomeMarkers.Icon.prototype.options.prefix = 'fa';
var nowIcon = L.AwesomeMarkers.icon({markerColor: 'green', icon: 'shopping-cart'});
var todayIcon = L.AwesomeMarkers.icon({markerColor: 'darkgreen', icon: 'shopping-cart'});
var otherIcon = L.AwesomeMarkers.icon({markerColor: 'cadetblue', icon: 'shopping-cart'});
var unclassifiedIcon = L.AwesomeMarkers.icon({markerColor: 'darkpurple', icon: 'shopping-cart'});



/*
 * Return 0-padded string of a number.
 */
function pad(num, totalDigits) {
    var s = num.toString();
    while (s.length < totalDigits) {
        s = '0' + s;
    }
    return s;
}


/*
 * Returns HTML for the next market date.
 */
function getNextMarketDateHtml(nextChange) {
    var html = '<p class="times">Nächster Termin: ' +
        moment(nextChange).format('DD. MMM') + ' ab ' +
        moment(nextChange).format('HH:mm') + ' Uhr.</p>';
    return html;
}


/*
 * Returns HTML for an undefined market date.
 */
function getUndefinedMarketDateHtml() {
    return '<p class="times">Nächster Termin: unbekannt</p>';
}


/*
 * Moves the map to its initial position.
 */
function positionMap(mapInitialization) {
    var coordinates = mapInitialization.coordinates;
    var zoomLevel = mapInitialization.zoom_level;
    map.setView(L.latLng(coordinates[1], coordinates[0]), zoomLevel);
}

/*
 * Gets a city object by ID
 */
function getCity(cityId) {
    return cityDirectory[cityId];
}

/*
 * Update layer controls.
 *
 * Controls which serve no purpose are disabled. For example, if
 * currently no markets are open then the corresponding radio
 * button is disabled. The most specific, active choice is selected.
 */
function updateControls() {
    var gotNow = nowGroup.getLayers().length > 0;
    var gotToday = todayGroup.getLayers().length > 0;
    $('#now').prop('disabled', !gotNow);
    $('#now').prop('checked', gotNow);
    $('#today').prop('disabled', !gotToday);
    $('#today').prop('checked', !gotNow && gotToday);
    $('#other').prop('checked', !gotNow && !gotToday);
}


/*
 * Update layer visibility according to layer control settings.
 */
function updateLayers() {
    var value = document.querySelector('[name="display"]:checked').value;
    map.removeLayer(nowGroup);
    map.removeLayer(todayGroup);
    map.removeLayer(otherGroup);
    map.removeLayer(unclassifiedGroup);
    map.addLayer(nowGroup);
    map.addLayer(unclassifiedGroup);
    switch (value) {
        case "today":
            map.addLayer(todayGroup);
            break;
        case "other":
            map.addLayer(todayGroup);
            map.addLayer(otherGroup);
            break;
    }
}

/*
 * Returns true if opening range matches the day of the given date; otherwise false.
 */
function openingRangeMatchesDay(openingRange, date) {
    var openFromDate = openingRange[0];
    var openTillDate = openingRange[1];
    var dayIndex = date.getDay();
    return openFromDate.getDay() === dayIndex && openTillDate.getDay() === dayIndex;
}

/*
 * Returns true if opening range contains the time of the given date; otherwise false.
 */
function openingRangeContainsTime(openingRange, date) {
    var range = moment.range(openingRange[0], openingRange[1]);
    return range.contains(date);
}


/*
 * Returns opening range for date or undefined.
 */
function getOpeningRangeForDate(openingRanges, date) {
    if (openingRanges !== undefined) {
        for (var index = 0, openingRangesLength = openingRanges.length; index < openingRangesLength; ++index) {
            var openingRange = openingRanges[index];

            var dayIsToday = openingRangeMatchesDay(openingRange, date);
            if (dayIsToday) {
                return openingRange;
            }
        }
    }
    return undefined;
}

/*
 * Update map markers from JSON market data.
 */
function updateMarkers(featureCollection) {
    nowGroup.clearLayers();
    todayGroup.clearLayers();
    otherGroup.clearLayers();
    unclassifiedGroup.clearLayers();
    L.geoJson(featureCollection, {
        onEachFeature: initMarker
    });
}

function initMarker(feature) {
    var properties = feature.properties;
    var openingHoursStrings = properties.opening_hours;
    if (openingHoursStrings === undefined) {
        throw "Missing property 'opening_hours' for " + properties.title + " (" + properties.location + ").";
    }
    var todayOpeningRange;
    var timeTableHtml;
    var openingHoursUnclassified;
    if (openingHoursStrings === null || openingHoursStrings.length === 0) {
        openingHoursUnclassified = properties.opening_hours_unclassified;
    } else {

        var openingTimes = new window.ohhf.OpeningTimes(openingHoursStrings);
        /* If no opening hours or a next date, don't show a marker. */
        if (openingTimes === undefined) {
            return;
        }

        var openingRanges = openingTimes.getOpeningRanges();
        var nextOpeningDate = openingTimes.getNextOpeningDate();

        /* Are there opening hours in the current week? */
        if (openingRanges !== undefined) {
            todayOpeningRange = getOpeningRangeForDate(openingRanges, now);
            var weekGenerator = new window.ohhf.WeekGenerator();
            var openingRangeFormatter = new window.ohhf.OpeningRangeFormatter();
            var week = weekGenerator.getWeek(openingRanges, openingRangeFormatter);
            var generator = new window.ohhf.WeekTableHtmlGenerator(week, now, DAY_NAMES_GERMAN);
            timeTableHtml = generator.getHtml();
        }
        /* Is there a next market date? */
        else if (nextOpeningDate !== undefined) {
            timeTableHtml = getNextMarketDateHtml(nextOpeningDate);
        } else {
            // Date might be in the past
            timeTableHtml = getUndefinedMarketDateHtml();
        }

    }

    var coordinates = feature.geometry.coordinates;
    var marker = L.marker(L.latLng(coordinates[1], coordinates[0]));
    var where = properties.location;
    if (where === undefined) {
        throw "Missing property 'location' for " + properties.title + ".";
    }
    if (where !== null) {
        where = '<p>' + where + '</p>';
    } else {
        where = '';
    }
    var title = properties.title;
    if (title === undefined) {
        throw "Missing property 'title'.";
    }
    if (title === null || title.length === 0) {
        title = DEFAULT_MARKET_TITLE;
    }
    var popupHtml = '<h1>' + title + '</h1>' + where;
    if (openingHoursUnclassified !== undefined) {
        popupHtml += '<p class="unclassified">' + openingHoursUnclassified + '</p>';
    } else {
        popupHtml += timeTableHtml;
    }
    marker.bindPopup(popupHtml);
    if (todayOpeningRange !== undefined) {
        if (openingRangeContainsTime(todayOpeningRange, now)) {
            marker.setIcon(nowIcon);
            nowGroup.addLayer(marker);
        } else {
            marker.setIcon(todayIcon);
            todayGroup.addLayer(marker);
        }
    } else {
        if (openingHoursUnclassified !== undefined) {
            marker.setIcon(unclassifiedIcon);
            unclassifiedGroup.addLayer(marker);
        } else {
            marker.setIcon(otherIcon);
            otherGroup.addLayer(marker);
        }
    }
}


/*
 * Returns the city ID from the hash of the current URI.
 */
function getHashCity() {
    var hash = decodeURIComponent(window.location.hash);
    if (hash === undefined || hash === "") {
        return '';
    } else {
        hash = hash.toLowerCase();
        return hash.substring(1, hash.length);
    }
}


/*
 * Updates the URL hash in the browser.
 *
 * `cityID` is the new city's ID. If `createNewHistoryEntry` is true then a new
 * entry in the browser's history is created for the change. Otherwise the
 * current history entry is replaced.
 */
function updateUrlHash(cityID, createNewHistoryEntry) {
    if (createNewHistoryEntry) {
        createHistoryEntryWithHash(cityID);
    } else {
        replaceHistoryEntryWithHash(cityID);
    }
}


/*
 * Create a new history entry by changing the URL fragment.
 *
 * `hash` is the new fragment (without `#`).
 */
function createHistoryEntryWithHash(hash) {
    if (history.pushState) {
        history.pushState(null, null, "#" + hash);
    } else {
        window.location.hash = hash;
    }
}


/*
 * Replace the current history entry by changing the URL fragment.
 *
 * `hash` is the new fragment (without `#`).
 */
function replaceHistoryEntryWithHash(hash) {
    hash = '#' + hash;
    if (history.replaceState) {
        history.replaceState(null, null, hash);
    } else {
        // http://stackoverflow.com/a/6945614/857390
        window.location.replace(('' + window.location).split('#')[0] + hash);
    }
}


/*
 * Returns the given string in camel case.
 */
function toCamelCase(str) {
    return str.replace(/(?:^|\s)\w/g, function(match) {
        return match.toUpperCase();
    });
}

/*
 * Updates the legend data source.
 */
function updateDataSource(dataSource) {
    var title = dataSource.title;
    var url = dataSource.url;
    $("#dataSource").html('<a href="' + url + '">' + title + '</a>');
}

/*
 * Loads the default city.
 *
 * If `createNewHistoryEntry` is true then a new
 * entry in the browser's history is created for the change. Otherwise the
 * current history entry is replaced.
 */
function loadDefaultCity(createNewHistoryEntry) {
    setCity(DEFAULT_CITY, createNewHistoryEntry);
}

/*
 * Set the current city.
 *
 * `cityID` is the new city's ID. If `createNewHistoryEntry` is true then a new
 * entry in the browser's history is created for the change. Otherwise the
 * current history entry is replaced.
 */
function setCity(cityID, createNewHistoryEntry) {
    cityID = cityID || DEFAULT_CITY_ID;
    var filename = 'cities/' + cityID + '.json';
    if (filename === CITY_LIST_API_URL) {
        return loadDefaultCity(false);
    }
    $.getJSON(filename, function(json) {
        positionMap(json.metadata.map_initialization);
        updateDataSource(json.metadata.data_source);
        updateMarkers(json);
        updateControls();
        updateLayers();
        updateUrlHash(cityID, createNewHistoryEntry);
        document.title = 'Wo ist Markt in ' + getCity(cityID).label + '?';

        // Update drop down but avoid recursion
        $('#dropDownCitySelection').val(cityID).trigger('change', true);
    }).fail(function() {
        console.log('Failure loading "' + filename + '".');
        if (cityID !== DEFAULT_CITY_ID) {
            console.log('Loading default city "' + DEFAULT_CITY_ID +
                        '" instead.');
            loadDefaultCity(createNewHistoryEntry);
        }
    });
}


/*
 * Load the IDs of the available cities.
 *
 * Returns a jQuery `Deferred` object that resolves to an array of city objects.
 */
function loadCities() {
    "use strict";
    var d = $.Deferred();
    $.get(CITY_LIST_API_URL, function(result) {
        var resultLength = result.length,
            resultMalformed = false;
        $.each(result, function(key, value) {
            if (value.id === undefined || value.label === undefined) {
                resultMalformed = true;
            }
        });
        if (resultMalformed) {
            d.reject();
        } else {
            d.resolve(result);
        }
    }).fail(function(e) {
        console.log("Loading " + CITY_LIST_API_URL + " failed.");
        d.reject(e);
    });
    return d;
}


/*
 * Collapse the header so that it only shows the most important information.
 */
function collapseHeader() {
    $('#details').slideUp({progress: fixMapHeight});
}

/*
 * Expand the header so that it shows all information.
 */
function expandHeader() {
    $('#details').slideDown({progress: fixMapHeight});
}


/*
 * Toggle collapsed/expanded header state.
 */
function toggleHeader() {
    if ($('#details').is(':visible')) {
        collapseHeader();
    } else {
        expandHeader();
    }
}


/*
 * Fix the height of #map so that it covers the whole viewport minus the
 * header.
 */
function fixMapHeight() {
    $('#map').outerHeight($(window).height() - $('#header').outerHeight(true));
}

$(window).on('resize', fixMapHeight);


$(window).on('hashchange',function() {
    // Don't create a new history state, because the hash change already did
    setCity(getHashCity(), false);
});


$(document).ready(function() {
    var tiles = new L.TileLayer(TILES_URL, {attribution: ATTRIBUTION});
    map = new L.Map('map').addLayer(tiles);
    var dropDownCitySelection = $('#dropDownCitySelection');
    $("input[name=display]").change(updateLayers);

    // add locator
    L.control.locate({keepCurrentZoomLevel: true}).addTo(map);

    // Populate dropdown
    loadCities().fail(function(e) {
        console.log("loadCities(); failed: ", e);
    }).done(function(cities) {
        // cache the results
        cityDirectory = cities;
        $.each(cityDirectory, function(key, value) {
            var city = value;
            dropDownCitySelection.append(
                $('<option></option>').val(city.id)
                                      .html(city.label)
            );
        });
        dropDownCitySelection.select2({
            minimumResultsForSearch: 10
        }).change(function(e, keepCity) {
            // If we programmatically change the select2 value then we also
            // need to trigger 'change'. However that would cause an infinite
            // recursion in our case since we're doing that from inside
            // setCity. Therefore we add a custom "keepCity" parameter that is
            // set when the change event is triggered from within setCity so
            // that we can avoid a recursion in that case.
            if (!keepCity) {
                setCity(dropDownCitySelection.val(), true);
            }
        }).on('select2:close', function() {
            $(':focus').blur();
        });
        // Force select2 update to fix dropdown position
        dropDownCitySelection.select2('open');
        dropDownCitySelection.select2('close');

        setCity(getHashCity(), false);
    });

    $('#btnToggleHeader').click(toggleHeader);
    fixMapHeight();
});


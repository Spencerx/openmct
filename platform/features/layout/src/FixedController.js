/*****************************************************************************
 * Open MCT, Copyright (c) 2014-2017, United States Government
 * as represented by the Administrator of the National Aeronautics and Space
 * Administration. All rights reserved.
 *
 * Open MCT is licensed under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 *
 * Open MCT includes source code licensed under additional open source
 * licenses. See the Open Source Licenses file (LICENSES.md) included with
 * this source code distribution or the Licensing information page available
 * at runtime from the About dialog for additional information.
 *****************************************************************************/

define(
    [
        'lodash',
        './FixedProxy',
        './elements/ElementProxies',
        './FixedDragHandle',
        '../../../../src/api/objects/object-utils'
    ],
    function (
        _,
        FixedProxy,
        ElementProxies,
        FixedDragHandle,
        objectUtils
    ) {

        var DEFAULT_DIMENSIONS = [2, 1];

        // Convert from element x/y/width/height to an
        // appropriate ng-style argument, to position elements.
        function convertPosition(elementProxy) {
            var gridSize = elementProxy.getGridSize();

            // Multiply position/dimensions by grid size
            return {
                left: (gridSize[0] * elementProxy.element.x) + 'px',
                top: (gridSize[1] * elementProxy.element.y) + 'px',
                width: (gridSize[0] * elementProxy.element.width) + 'px',
                height: (gridSize[1] * elementProxy.element.height) + 'px'
            };
        }

        /**
         * The FixedController is responsible for supporting the
         * Fixed Position view. It arranges frames according to saved
         * configuration and provides methods for updating these based on
         * mouse movement.
         * @memberof platform/features/layout
         * @constructor
         * @param {Scope} $scope the controller's Angular scope
         */
        function FixedController($scope, $q, dialogService, openmct, $element) {
            this.names = {}; // Cache names by ID
            this.values = {}; // Cache values by ID
            this.elementProxiesById = {};
            this.telemetryObjects = [];
            this.subscriptions = [];
            this.openmct = openmct;
            this.$element = $element;
            this.$scope = $scope;
            this.dialogService = dialogService;
            this.$q = $q;
            this.newDomainObject = $scope.domainObject.useCapability('adapter');
            this.gridSize = this.newDomainObject.layoutGrid;
            this.fixedViewSelectable = false;

            var self = this;
            [
                'digest',
                'fetchHistoricalData',
                'getTelemetry',
                'setDisplayedValue',
                'subscribeToObjects',
                'unsubscribe',
                'updateView'
            ].forEach(function (name) {
                self[name] = self[name].bind(self);
            });

            // Update element positions when grid size changes
            function updateElementPositions(layoutGrid) {
                // Update grid size from model
                self.gridSize = layoutGrid;

                self.elementProxies.forEach(function (elementProxy) {
                    elementProxy.setGridSize(self.gridSize);
                    elementProxy.style = convertPosition(elementProxy);
                });
            }

            // Decorate an element for display
            function makeProxyElement(element, index, elements) {
                var ElementProxy = ElementProxies[element.type],
                    e = ElementProxy && new ElementProxy(element, index, elements, self.gridSize);

                if (e) {
                    // Provide a displayable position (convert from grid to px)
                    e.style = convertPosition(e);
                    // Template names are same as type names, presently
                    e.template = element.type;
                }

                return e;
            }

            // Decorate elements in the current configuration
            function refreshElements() {
                var elements = (((self.newDomainObject.configuration || {})['fixed-display'] || {}).elements || []);

                // Create the new proxies...
                self.elementProxies = elements.map(makeProxyElement);

                if (self.selectedElementProxy) {
                    // If selection is not in array, select parent.
                    // Otherwise, set the element to select after refresh.
                    var index = elements.indexOf(self.selectedElementProxy.element);
                    if (index === -1) {
                        self.$element[0].click();
                    } else if (!self.elementToSelectAfterRefresh) {
                        self.elementToSelectAfterRefresh = self.elementProxies[index].element;
                    }
                }

                // Finally, rebuild lists of elements by id to
                // facilitate faster update when new telemetry comes in.
                self.elementProxiesById = {};
                self.elementProxies.forEach(function (elementProxy) {
                    var id = elementProxy.id;
                    if (elementProxy.element.type === 'fixed.telemetry') {
                        // Provide it a cached name/value to avoid flashing
                        elementProxy.name = self.names[id];
                        elementProxy.value = self.values[id];
                        self.elementProxiesById[id] = self.elementProxiesById[id] || [];
                        self.elementProxiesById[id].push(elementProxy);
                    }
                });
            }

            function removeObjects(ids) {
                var configuration = self.$scope.configuration;

                if (configuration &&
                    configuration.elements) {
                    configuration.elements = configuration.elements.filter(function (proxy) {
                        return ids.indexOf(proxy.id) === -1;
                    });
                }
                self.getTelemetry($scope.domainObject);
                refreshElements();

                self.commit();
            }

            // Trigger a new query for telemetry data
            function updateDisplayBounds(bounds, isTick) {
                if (!isTick) {
                    //Reset values
                    self.values = {};
                    refreshElements();
                    //Fetch new data
                    self.fetchHistoricalData(self.telemetryObjects);
                }
            }

            // Add an element to this view
            function addElement(element) {
                // Ensure that configuration field is populated
                $scope.configuration = $scope.configuration || {};
                // Make sure there is a "elements" field in the
                // view configuration.
                $scope.configuration.elements =
                    $scope.configuration.elements || [];
                // Store the position of this element.
                $scope.configuration.elements.push(element);

                self.elementToSelectAfterRefresh = element;

                // Refresh displayed elements
                refreshElements();

                self.commit();
            }

            // Position a panel after a drop event
            function handleDrop(e, id, position) {
                // Don't handle this event if it has already been handled
                // color is set to "" to let the CSS theme determine the default color
                if (e.defaultPrevented) {
                    return;
                }

                e.preventDefault();
                // Store the position of this element.
                addElement({
                    type: "fixed.telemetry",
                    x: Math.floor(position.x / self.gridSize[0]),
                    y: Math.floor(position.y / self.gridSize[1]),
                    id: id,
                    stroke: "transparent",
                    color: "",
                    titled: true,
                    width: DEFAULT_DIMENSIONS[0],
                    height: DEFAULT_DIMENSIONS[1],
                    useGrid: true
                });

                //Re-initialize objects, and subscribe to new object
                self.getTelemetry($scope.domainObject);
            }

            this.elementProxies = [];
            this.addElement = addElement;
            this.refreshElements = refreshElements;

            // Detect changes to grid size
            // $scope.$watch("model.layoutGrid", updateElementPositions);

            // Position panes where they are dropped
            // $scope.$on("mctDrop", handleDrop);

            // Position panes when the model field changes
            // $scope.$watch("model.composition", updateComposition);
            // TODO: implement Composition
            var composition = this.openmct.composition.get(this.newDomainObject);
            composition.on('add', this.addObject, this);
            composition.on('remove', this.removeObject, this);
            composition.load();

            // Subscribe to telemetry when an object is available
            // $scope.$watch("domainObject", this.getTelemetry);

            $scope.$on("$destroy", this.destroy.bind(this));

            // Respond to external bounds changes
            this.openmct.time.on("bounds", updateDisplayBounds);
            this.openmct.selection.on('change', this.setSelection.bind(this));
            this.$element.on('click', this.bypassSelection.bind(this));

            this.unlisten = this.openmct.objects.observe(this.newDomainObject, '*', function (obj) {
                this.newDomainObject = JSON.parse(JSON.stringify(obj));
            }.bind(this));

            refreshElements();

            window.fc = this;
        }

        FixedController.prototype.generateDragHandle = function (elementProxy) {
            var index = this.elementProxies.indexOf(elementProxy);
            return new FixedDragHandle(
                elementProxy,
                "configuration['fixed-display'].elements[" + index + "]",
                this
            );
        };

        FixedController.prototype.generateDragHandles = function (elementProxy) {
            return elementProxy.handles().map(this.generateDragHandle, this);
        };

        FixedController.prototype.updateSelectionStyle = function () {
            this.selectedElementProxy.style = convertPosition(this.selectedElementProxy);
        };

        FixedController.prototype.setSelection = function (selectable) {
            var selection = selectable[0];

            if (this.selectionListeners) {
                this.selectionListeners.forEach(function (l) {
                    l();
                });
            }

            this.selectionListeners = [];

            if (!selection) {
                return;
            }

            if (selection.context.elementProxy) {
                this.selectedElementProxy = selection.context.elementProxy;
                var index = this.elementProxies.indexOf(this.selectedElementProxy);
                var path = "configuration['fixed-display'].elements[" + index + "]";

                this.selectionListeners.push(this.openmct.objects.observe(this.newDomainObject, path + ".useGrid", function (newValue) {
                    if (this.selectedElementProxy.useGrid() !== newValue) {
                        this.selectedElementProxy.useGrid(newValue);
                        this.updateSelectionStyle();
                        this.openmct.objects.mutate(this.newDomainObject, path, this.selectedElementProxy.element);
                    }
                }.bind(this)));

                [
                    "width",
                    "height",
                    "stroke",
                    "fill",
                    "x",
                    "y",
                    "x1",
                    "y1",
                    "x2",
                    "y2",
                    "color",
                    "size",
                    "text"
                ].forEach(function (property) {
                    this.selectionListeners.push(this.openmct.objects.observe(this.newDomainObject, path + "." + property, function (newValue) {
                        this.selectedElementProxy.element[property] = newValue;
                        this.updateSelectionStyle();
                    }.bind(this)));
                }.bind(this));

                this.mvHandle = this.generateDragHandle(this.selectedElementProxy);
                this.resizeHandles = this.generateDragHandles(this.selectedElementProxy);
            } else {
                // Make fixed view selectable if it's not already.
                if (!this.fixedViewSelectable && selectable.length === 1) {
                    this.fixedViewSelectable = true;
                    selection.context.viewProxy = new FixedProxy(this.addElement, this.$q, this.dialogService);
                    this.openmct.selection.select(selection);
                }

                this.resizeHandles = [];
                this.mvHandle = undefined;
                this.selectedElementProxy = undefined;
            }
        };

        FixedController.prototype.destroy = function () {
            this.unsubscribe();
            this.unlisten();
            this.openmct.time.off("bounds", this.updateDisplayBounds);
            this.openmct.selection.off("change", this.setSelection);
        };

        /**
         * A rate-limited digest function. Caps digests at 60Hz
         * @private
         */
        FixedController.prototype.digest = function () {
            var self = this;

            if (!this.digesting) {
                this.digesting = true;
                requestAnimationFrame(function () {
                    self.$scope.$digest();
                    self.digesting = false;
                });
            }
        };

        /**
         * Unsubscribe all listeners
         * @private
         */
        FixedController.prototype.unsubscribe = function () {
            this.subscriptions.forEach(function (unsubscribeFunc) {
                unsubscribeFunc();
            });
            this.subscriptions = [];
            this.telemetryObjects = [];
        };

        /**
         * Subscribe to all given domain objects
         * @private
         * @param {object[]} objects  Domain objects to subscribe to
         * @returns {object[]} The provided objects, for chaining.
         */
        FixedController.prototype.subscribeToObjects = function (objects) {
            var self = this;
            var timeAPI = this.openmct.time;

            this.subscriptions = objects.map(function (object) {
                return self.openmct.telemetry.subscribe(object, function (datum) {
                    if (timeAPI.clock() !== undefined) {
                        self.updateView(object, datum);
                    }
                }, {});
            });
            return objects;
        };

        /**
         * Print the values from the given datum against the provided object in the view.
         * @private
         * @param {object} telemetryObject The domain object associated with the given telemetry data
         * @param {object} datum The telemetry datum containing the values to print
         */
        FixedController.prototype.updateView = function (telemetryObject, datum) {
            var metadata = this.openmct.telemetry.getMetadata(telemetryObject);
            var telemetryKeyToDisplay = this.chooseTelemetryKeyToDisplay(metadata);
            var formattedTelemetryValue = this.getFormattedTelemetryValueForKey(telemetryKeyToDisplay, datum, metadata);
            var limitEvaluator = this.openmct.telemetry.limitEvaluator(telemetryObject);
            var alarm = limitEvaluator && limitEvaluator.evaluate(datum, telemetryKeyToDisplay);

            this.setDisplayedValue(
                telemetryObject,
                formattedTelemetryValue,
                alarm && alarm.cssClass
            );
            this.digest();
        };

        /**
         * @private
         */
        FixedController.prototype.getFormattedTelemetryValueForKey = function (telemetryKeyToDisplay, datum, metadata) {
            var valueMetadata = metadata.value(telemetryKeyToDisplay);
            var formatter = this.openmct.telemetry.getValueFormatter(valueMetadata);

            return formatter.format(datum[valueMetadata.key]);
        };

        /**
         * @private
         */
        FixedController.prototype.chooseTelemetryKeyToDisplay = function (metadata) {
            // If there is a range value, show that preferentially
            var telemetryKeyToDisplay = metadata.valuesForHints(['range'])[0];

            // If no range is defined, default to the highest priority non time-domain data.
            if (telemetryKeyToDisplay === undefined) {
                var valuesOrderedByPriority = metadata.values();
                telemetryKeyToDisplay = valuesOrderedByPriority.filter(function (valueMetadata) {
                    return !(valueMetadata.hints.domain);
                })[0];
            }

            return telemetryKeyToDisplay.source;
        };

        /**
         * Request the last historical data point for the given domain objects
         * @param {object[]} objects
         * @returns {object[]} the provided objects for chaining.
         */
        FixedController.prototype.fetchHistoricalData = function (objects) {
            var bounds = this.openmct.time.bounds();
            var self = this;

            objects.forEach(function (object) {
                self.openmct.telemetry.request(object, {start: bounds.start, end: bounds.end, size: 1})
                    .then(function (data) {
                        if (data.length > 0) {
                            self.updateView(object, data[data.length - 1]);
                        }
                    });
            });
            return objects;
        };


        /**
         * Print a value to the onscreen element associated with a given telemetry object.
         * @private
         * @param {object} telemetryObject The telemetry object associated with the value
         * @param {string | number} value The value to print to screen
         * @param {string} [cssClass] an optional CSS class to apply to the onscreen element.
         */
        FixedController.prototype.setDisplayedValue = function (telemetryObject, value, cssClass) {
            var id = objectUtils.makeKeyString(telemetryObject.identifier);
            var self = this;

            (self.elementProxiesById[id] || []).forEach(function (element) {
                self.names[id] = telemetryObject.name;
                self.values[id] = value;
                element.name = self.names[id];
                element.value = self.values[id];
                element.cssClass = cssClass;
            });
        };

        FixedController.prototype.getTelemetry = function (domainObject) {
            var newObject = domainObject.useCapability('adapter');
            var self = this;

            if (this.subscriptions.length > 0) {
                this.unsubscribe();
            }

            function filterForTelemetryObjects(objects) {
                return objects.filter(function (object) {
                    return self.openmct.telemetry.canProvideTelemetry(object);
                });
            }

            function initializeDisplay(objects) {
                self.telemetryObjects = objects;
                objects.forEach(function (object) {
                    // Initialize values
                    self.setDisplayedValue(object, "");
                });
                return objects;
            }

            return this.openmct.composition.get(newObject).load()
                .then(filterForTelemetryObjects)
                .then(initializeDisplay)
                .then(this.fetchHistoricalData)
                .then(this.subscribeToObjects);
        };

        /**
         * Get the size of the grid, in pixels. The returned array
         * is in the form `[x, y]`.
         * @returns {number[]} the grid size
         * @memberof platform/features/layout.FixedController#
         */
        FixedController.prototype.getGridSize = function () {
            return this.gridSize;
        };

        /**
         * Get an array of elements in this panel; these are
         * decorated proxies for both selection and display.
         * @returns {Array} elements in this panel
         */
        FixedController.prototype.getElements = function () {
            return this.elementProxies;
        };

        /**
         * Checks if the element should be selected or not.
         *
         * @param elementProxy the element to check
         * @returns {boolean} true if the element should be selected.
         */
        FixedController.prototype.shouldSelect = function (elementProxy) {
            if (elementProxy.element === this.elementToSelectAfterRefresh) {
                delete this.elementToSelectAfterRefresh;
                return true;
            } else {
                return false;
            }
        };

        /**
         * Checks if an element is currently selected.
         *
         * @returns {boolean} true if an element is selected.
         */
        FixedController.prototype.isElementSelected = function () {
            return (this.selectedElementProxy) ? true : false;
        };

        /**
         * Gets the style for the selected element.
         *
         * @returns {string} element style
         */
        FixedController.prototype.getSelectedElementStyle = function () {
            return (this.selectedElementProxy) ? this.selectedElementProxy.style : undefined;
        };

        /**
         * Gets the selected element.
         *
         * @returns the selected element
         */
         // TODO: unused function, remove it
        FixedController.prototype.getSelectedElement = function () {
            return this.selectedElementProxy;
        };

        /**
         * Prevents the event from bubbling up if drag is in progress.
         */
        FixedController.prototype.bypassSelection = function ($event) {
            if (this.dragInProgress) {
                if ($event) {
                    $event.stopPropagation();
                }
                return;
            }
        };

        /**
         * Get drag handles.
         * @returns {platform/features/layout.FixedDragHandle[]}
         *          drag handles for the current selection
         */
        FixedController.prototype.handles = function () {
            return this.resizeHandles;
        };

        /**
         * Get the handle to handle dragging to reposition an element.
         * @returns {platform/features/layout.FixedDragHandle} the drag handle
         */
        FixedController.prototype.moveHandle = function () {
            return this.mvHandle;
        };

        /**
         * Gets the selection context.
         *
         * @param elementProxy the element proxy
         * @returns {object} the context object which includes elementProxy
         */
        FixedController.prototype.getContext = function (elementProxy) {
            return {
                elementProxy: elementProxy
            };
        };

        /**
         * End drag.
         *
         * @param handle the resize handle
         */
        FixedController.prototype.endDrag = function (handle) {
            this.dragInProgress = true;

            setTimeout(function () {
                this.dragInProgress = false;
            }.bind(this), 0);

            if (handle) {
                handle.endDrag();
            } else {
                this.moveHandle().endDrag();
            }
        };

        FixedController.prototype.mutate = function (property, value) {
            this.openmct.objects.mutate(this.newDomainObject, property, value);
        };

        FixedController.prototype.commit = function () {

        };

        return FixedController;
    }
);

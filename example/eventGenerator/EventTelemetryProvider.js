/*****************************************************************************
 * Open MCT, Copyright (c) 2014-2024, United States Government
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

/**
 * Module defining EventTelemetryProvider. Created by chacskaylo on 06/18/2015.
 */

import { SEVERITY_CSS } from './EventLimitProvider.js';
import messages from './transcript.json';

const DUR_MIN = 1000;
const DUR_MAX = 10000;
class EventTelemetryProvider {
  constructor() {
    this.defaultSize = 25;
  }

  generateData(firstObservedTime, count, startTime, duration, name) {
    const millisecondsSinceStart = startTime - firstObservedTime;
    const randStartDelay = Math.max(DUR_MIN, Math.random() * DUR_MAX);
    const utc = startTime + randStartDelay + count * duration;
    const ind = count % messages.length;
    const message = messages[ind] + ' - [' + millisecondsSinceStart + ']';
    // pick a random severity level + 1 for an undefined level so we can do nominal
    const severity =
      Math.random() > 0.4
        ? Object.keys(SEVERITY_CSS)[
            Math.floor(Math.random() * Object.keys(SEVERITY_CSS).length + 1)
          ]
        : undefined;

    return {
      name,
      utc,
      message,
      severity
    };
  }

  supportsRequest(domainObject) {
    return domainObject.type === 'eventGenerator';
  }

  supportsSubscribe(domainObject) {
    return domainObject.type === 'eventGenerator';
  }

  subscribe(domainObject, callback) {
    const duration = domainObject.telemetry.duration * DUR_MIN;
    const firstObservedTime = Date.now();
    let count = 0;

    const interval = setInterval(() => {
      const startTime = Date.now();
      const datum = this.generateData(
        firstObservedTime,
        count,
        startTime,
        duration,
        domainObject.name
      );
      count += 1;
      callback(datum);
    }, duration);

    return function () {
      clearInterval(interval);
    };
  }

  request(domainObject, options) {
    let start = options.start;
    const end = Math.min(Date.now(), options.end); // no future values
    const duration = domainObject.telemetry.duration * DUR_MIN;
    const size = options.size ? options.size : this.defaultSize;
    const data = [];
    const firstObservedTime = options.start;
    let count = 0;

    if (options.strategy === 'latest' || options.size === 1) {
      start = end;
    }

    while (start <= end && data.length < size) {
      const startTime = options.start + count;
      data.push(
        this.generateData(firstObservedTime, count, startTime, duration, domainObject.name)
      );
      start += duration;
      count += 1;
    }

    return Promise.resolve(data);
  }
}

export default EventTelemetryProvider;

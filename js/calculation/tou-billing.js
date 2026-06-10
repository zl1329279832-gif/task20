/**
 * tou-billing.js
 * Time-of-Use (TOU) billing calculations for building energy analysis.
 * All functions are pure -- no DOM access.
 */

/**
 * Default TOU pricing aligned with TOU_PERIODS from constants.js.
 * Prices are in CNY/kWh (representative tier-1 commercial rates).
 * @returns {Array<{ time_period: string, start_time: number, end_time: number, price_per_kwh: number }>}
 */
export function getDefaultTOUPricing() {
  return [
    // Sharp: 10-12, 19-21
    { time_period: 'sharp', start_time: 10, end_time: 12, price_per_kwh: 1.42 },
    { time_period: 'sharp', start_time: 19, end_time: 21, price_per_kwh: 1.42 },
    // Peak: 8-10, 12-17, 21-23
    { time_period: 'peak', start_time: 8, end_time: 10, price_per_kwh: 1.15 },
    { time_period: 'peak', start_time: 12, end_time: 17, price_per_kwh: 1.15 },
    { time_period: 'peak', start_time: 21, end_time: 23, price_per_kwh: 1.15 },
    // Flat: 7-8, 17-19, 23-24
    { time_period: 'flat', start_time: 7, end_time: 8, price_per_kwh: 0.78 },
    { time_period: 'flat', start_time: 17, end_time: 19, price_per_kwh: 0.78 },
    { time_period: 'flat', start_time: 23, end_time: 24, price_per_kwh: 0.78 },
    // Valley: 0-7
    { time_period: 'valley', start_time: 0, end_time: 7, price_per_kwh: 0.38 }
  ];
}

/**
 * Classify a given hour (0-23) into a TOU period key.
 * Uses the touPricing array to determine which period an hour belongs to.
 * Falls back to 'flat' if the hour is not covered by any period.
 *
 * @param {number} hour - Hour of the day (0-23).
 * @param {Array<{ time_period: string, start_time: number, end_time: number, price_per_kwh: number }>} touPricing
 * @returns {string} Period key ('sharp', 'peak', 'flat', 'valley').
 */
export function classifyHourToPeriod(hour, touPricing) {
  if (hour < 0 || hour > 23 || !Number.isFinite(hour)) {
    return 'flat';
  }

  const pricing = touPricing || getDefaultTOUPricing();
  for (const slot of pricing) {
    // Handle normal ranges where start < end
    if (slot.start_time <= hour && hour < slot.end_time) {
      return slot.time_period;
    }
  }

  // Fallback if hour not matched
  return 'flat';
}

/**
 * Look up the price for a given period key from the pricing array.
 * @param {string} periodKey
 * @param {Array} touPricing
 * @returns {number}
 */
function getPriceForPeriod(periodKey, touPricing) {
  const slot = touPricing.find(s => s.time_period === periodKey);
  return slot ? slot.price_per_kwh : 0;
}

/**
 * Calculate TOU billing for an array of meter readings.
 * Handles cross-day billing by splitting readings that span midnight proportionally.
 *
 * @param {Array<{ timestamp: string|number, power_consumption: number, device_id: string }>} readings
 * @param {Array<{ time_period: string, start_time: number, end_time: number, price_per_kwh: number }>} [touPricing]
 * @returns {{
 *   totalCost: number,
 *   totalConsumption: number,
 *   breakdown: {
 *     sharp: { kwh: number, cost: number },
 *     peak:  { kwh: number, cost: number },
 *     flat:  { kwh: number, cost: number },
 *     valley:{ kwh: number, cost: number }
 *   },
 *   details: Array<{
 *     timestamp: string|number,
 *     device_id: string,
 *     power_consumption: number,
 *     period: string,
 *     price: number,
 *     cost: number
 *   }>
 * }}
 */
export function calculateTOUBilling(readings, touPricing) {
  const pricing = touPricing || getDefaultTOUPricing();

  const breakdown = {
    sharp:  { kwh: 0, cost: 0 },
    peak:   { kwh: 0, cost: 0 },
    flat:   { kwh: 0, cost: 0 },
    valley: { kwh: 0, cost: 0 }
  };
  const details = [];
  let totalCost = 0;
  let totalConsumption = 0;

  if (!Array.isArray(readings) || readings.length === 0) {
    return { totalCost, totalConsumption, breakdown, details };
  }

  // Sort readings by timestamp for proper interval detection
  const sorted = [...readings].sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  for (let i = 0; i < sorted.length; i++) {
    const reading = sorted[i];
    const consumption = Number(reading.power_consumption);
    if (!Number.isFinite(consumption) || consumption < 0) {
      continue;
    }

    const ts = new Date(reading.timestamp);
    if (isNaN(ts.getTime())) {
      continue;
    }

    const hour = ts.getHours();
    const minutes = ts.getMinutes();

    // Determine the interval duration.
    // If we have a next reading, compute interval to it; otherwise assume 1 hour.
    let intervalHours = 1;
    if (i + 1 < sorted.length) {
      const nextTs = new Date(sorted[i + 1].timestamp);
      if (!isNaN(nextTs.getTime())) {
        intervalHours = (nextTs.getTime() - ts.getTime()) / (1000 * 60 * 60);
        if (intervalHours <= 0 || intervalHours > 24) {
          intervalHours = 1;
        }
      }
    }

    // Check if the reading interval spans midnight (cross-day).
    const startMinuteOfDay = hour * 60 + minutes;
    const endMinuteOfDay = startMinuteOfDay + intervalHours * 60;

    if (endMinuteOfDay > 24 * 60) {
      // Cross-day: split proportionally between today and tomorrow.
      const minutesBeforeMidnight = 24 * 60 - startMinuteOfDay;
      const minutesAfterMidnight = endMinuteOfDay - 24 * 60;
      const totalMinutes = minutesBeforeMidnight + minutesAfterMidnight;

      // Proportion before midnight
      const fractionBefore = minutesBeforeMidnight / totalMinutes;
      const consumptionBefore = consumption * fractionBefore;
      const consumptionAfter = consumption * (1 - fractionBefore);

      // Classify the "before midnight" portion
      const periodBefore = classifyHourToPeriod(hour, pricing);
      const priceBefore = getPriceForPeriod(periodBefore, pricing);
      const costBefore = consumptionBefore * priceBefore;

      breakdown[periodBefore].kwh += consumptionBefore;
      breakdown[periodBefore].cost += costBefore;
      totalCost += costBefore;
      totalConsumption += consumptionBefore;

      details.push({
        timestamp: reading.timestamp,
        device_id: reading.device_id,
        power_consumption: consumptionBefore,
        period: periodBefore,
        price: priceBefore,
        cost: costBefore
      });

      // Classify the "after midnight" portion (hour 0)
      const periodAfter = classifyHourToPeriod(0, pricing);
      const priceAfter = getPriceForPeriod(periodAfter, pricing);
      const costAfter = consumptionAfter * priceAfter;

      breakdown[periodAfter].kwh += consumptionAfter;
      breakdown[periodAfter].cost += costAfter;
      totalCost += costAfter;
      totalConsumption += consumptionAfter;

      details.push({
        timestamp: reading.timestamp,
        device_id: reading.device_id,
        power_consumption: consumptionAfter,
        period: periodAfter,
        price: priceAfter,
        cost: costAfter
      });
    } else {
      // Normal single-period reading
      const period = classifyHourToPeriod(hour, pricing);
      const price = getPriceForPeriod(period, pricing);
      const cost = consumption * price;

      breakdown[period].kwh += consumption;
      breakdown[period].cost += cost;
      totalCost += cost;
      totalConsumption += consumption;

      details.push({
        timestamp: reading.timestamp,
        device_id: reading.device_id,
        power_consumption: consumption,
        period,
        price,
        cost
      });
    }
  }

  // Round monetary values to avoid floating point noise
  totalCost = Math.round(totalCost * 100) / 100;
  for (const key of Object.keys(breakdown)) {
    breakdown[key].kwh = Math.round(breakdown[key].kwh * 1000) / 1000;
    breakdown[key].cost = Math.round(breakdown[key].cost * 100) / 100;
  }

  return { totalCost, totalConsumption, breakdown, details };
}

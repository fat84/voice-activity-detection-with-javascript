/*
 * Voice Activity Detection (VAD) Library
 * http://www.happyworm.com
 *
 * Copyright (c) 2014 Happyworm Ltd
 * Licensed under the MIT license.
 * http://opensource.org/licenses/MIT
 *
 * Author: Mark J Panaghiston
 * Version: 0.1.0
 * Date: 6th May 2014
 */

(function(PM) {

	var DEBUG = true;

	var Vad = function(options) {
		this.init(options);
	};

	if(typeof PM === 'undefined') {
		window.Vad = Vad; // 
	} else {
		PM.Vad = function(options) {
			return new Vad(options); // 
		};
	}

	Vad.prototype = {
		init: function(options) {
			// The default options
			this.options = {
				id: '', // The id of messages being broadcast.
				probe: null, // A Probe instance.
				energy_offset: 1e-8, // The initial offset.
				energy_threshold_ratio_pos: 4, // Signal must be twice the offset
				energy_threshold_ratio_neg: 0.5, // Signal must be half the offset
				//energy_integration: 100, // Offset change per iteration. ie., a 1/100th of the signal size
				energy_integration: 0.5, // Size of integration change compared to the signal per second.
				filter: [
					{f: 200, v:0}, // 0 -> 200 is 0
					{f: 1000, v:1} // 200 -> 2k is 1
				],
				context: null
			};
			// Read in instancing options.
			for(var option in options) {
				if(options.hasOwnProperty(option)) {
					this.options[option] = options[option];
				}
			}

			// The Web Audio API context
			this.context = PM && PM.context ? PM.context : this.options.context;

			// Calculate time relationships
			this.hertzPerBin = this.context.sampleRate / this.options.probe.options.fftSize;
			this.iterationFrequency = this.context.sampleRate / this.options.probe.options.scriptSize;
			this.iterationPeriod = 1 / this.iterationFrequency;

			if(DEBUG) console.log(
				'Vad[' + this.options.id + ']' +
				' | sampleRate: ' + this.context.sampleRate +
				' | hertzPerBin: ' + this.hertzPerBin +
				' | iterationFrequency: ' + this.iterationFrequency +
				' | iterationPeriod: ' + this.iterationPeriod
			);

			this.setFilter(this.options.filter);

			this.ready = {};
			this.vadState = false; // True when Voice Activity Detected

			// Energy detector props
			this.energy_offset = this.options.energy_offset;
			this.energy_threshold_pos = this.energy_offset * this.options.energy_threshold_ratio_pos;
			this.energy_threshold_neg = this.energy_offset * this.options.energy_threshold_ratio_neg;

			this.voiceTrend = 0;
			this.voiceTrendMax = 10;
			this.voiceTrendMin = -10;
			this.voiceTrendStart = 5;
			this.voiceTrendEnd = -5;

			// Setup local storage of the Linear FFT data
			this.floatFrequencyDataLinear = new Float32Array(this.options.probe.floatFrequencyData.length);

			// log stuff
			this.logging = false;
			this.log_i = 0;
			this.log_limit = 100;
		},
		triggerLog: function(limit) {
			this.logging = true;
			this.log_i = 0;
			this.log_limit = typeof limit === 'number' ? limit : this.log_limit;
		},
		log: function(msg) {
			if(this.logging && this.log_i < this.log_limit) {
				this.log_i++;
				console.log(msg);
			} else {
				this.logging = false;
			}
		},
		update: function() {
			// Update the local version of the Linear FFT
			var fft = this.options.probe.floatFrequencyData;
			for(var i = 0, iLen = fft.length; i < iLen; i++) {
				this.floatFrequencyDataLinear[i] = Math.pow(10, fft[i] / 10);
			}
			this.ready = {};
		},
		broadcast: function(type) {
			// Broadcast the message
			if(PM) {
				PM.broadcast(type, {
					id: this.options.id,
					target: this,
					voiceTrend: this.voiceTrend,
					msg: 'Generated by: Vad'
				});
			}
		},
		setFilter: function(shape) {
			this.filter = [];
			for(var i = 0, iLen = this.options.probe.options.fftSize / 2; i < iLen; i++) {
				this.filter[i] = 0;
				for(var j = 0, jLen = shape.length; j < jLen; j++) {
					if(i * this.hertzPerBin < shape[j].f) {
						this.filter[i] = shape[j].v;
						break; // Exit j loop
					}
				}
			}
		},
		getEnergy: function() {

			if(this.ready.energy) {
				return this.energy;
			}

			var energy = 0;
			var fft = this.floatFrequencyDataLinear;

			for(var i = 0, iLen = fft.length; i < iLen; i++) {
				energy += this.filter[i] * fft[i] * fft[i];
			}

			this.energy = energy;
			this.ready.energy = true;

			return energy;
		},
		// No longer used
		getSFM: function() {

			var geometric = 0;
			var arithmetic = 0;

			var fft = this.floatFrequencyDataLinear;

			for(var i = 0, iLen = fft.length; i < iLen; i++) {
				// this.log("fft[" + i + "]: " + fft[i]);
				geometric += Math.log(fft[i]);
				arithmetic += fft[i];
			}

			geometric = Math.exp(geometric / fft.length);
			arithmetic = arithmetic / fft.length;

			var SF = geometric / arithmetic;
			var SFM = 10 * Math.log(SF) / Math.log(10);

			this.log(
				"geometric: " + geometric +
				" | arithmetic: " + arithmetic +
				" | SF: " + SF +
				" | SFM: " + SFM +
				" | fft.length: " + fft.length
			);

			return SFM;
		},
		monitor: function() {
			var self = this;
			var energy = this.getEnergy();
			var signal = energy - this.energy_offset;

			if(signal > this.energy_threshold_pos) {
				this.voiceTrend = (this.voiceTrend + 1 > this.voiceTrendMax) ? this.voiceTrendMax : this.voiceTrend + 1;
			} else if(signal < -this.energy_threshold_neg) {
				this.voiceTrend = (this.voiceTrend - 1 < this.voiceTrendMin) ? this.voiceTrendMin : this.voiceTrend - 1;
			} else {
				// voiceTrend gets smaller
				if(this.voiceTrend > 0) {
					this.voiceTrend--;
				} else if(this.voiceTrend < 0) {
					this.voiceTrend++;
				}
			}

			var start = false, end = false;
			if(this.voiceTrend > this.voiceTrendStart) {
				// Start of speech detected
				start = true;
			} else if(this.voiceTrend < this.voiceTrendEnd) {
				// End of speech detected
				end = true;
			}

			// Integration brings in the real-time aspect through the relationship with the frequency this functions is called.
			var integration = signal * this.iterationPeriod * this.options.energy_integration;

			// Idea?: The integration is affected by the voiceTrend magnitude? - Not sure. Not doing atm.

			// The !end limits the offset delta boost till after the end is detected.
			if(integration > 0 || !end) {
				this.energy_offset += integration;
			} else {
				this.energy_offset += integration * 10;
			}
			this.energy_offset = this.energy_offset < 0 ? 0 : this.energy_offset;
			this.energy_threshold_pos = this.energy_offset * this.options.energy_threshold_ratio_pos;
			this.energy_threshold_neg = this.energy_offset * this.options.energy_threshold_ratio_neg;

			// Broadcast the messages
			if(start && !this.vadState) {
				this.vadState = true;
				this.broadcast("energy_jump");
			}
			if(end && this.vadState) {
				this.vadState = false;
				this.broadcast("energy_fall");
			}
			this.broadcast("energy_update");

			this.log(
				'e: ' + energy +
				' | e_of: ' + this.energy_offset +
				' | e+_th: ' + this.energy_threshold_pos +
				' | e-_th: ' + this.energy_threshold_neg +
				' | signal: ' + signal +
				' | int: ' + integration +
				' | voiceTrend: ' + this.voiceTrend +
				' | start: ' + start +
				' | end: ' + end
			);

			return signal;
		}
	};
	return Vad;
}(window.PM));

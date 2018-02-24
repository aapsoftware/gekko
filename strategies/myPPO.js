/*

  PPO - cykedev 15/01/2014

  (updated a couple of times since, check git history)

 */

// helpers
var _ = require('lodash');
var log = require('../core/log');

// let's create our own method
var method = {};

// prepare everything our method needs
method.init = function() {
  this.name = 'myPPO';
  log.debug('candleSize: ',this.tradingAdvisor.candleSize);
  log.debug('history: ',this.tradingAdvisor.historySize);
  log.debug(this.tradingAdvisor)
  this.trend = {
    direction: 'none',
    duration: 0,
    persisted: false,
    adviced: false,
    startPrice: 0
  };

  this.startTrading = true;
  if (this.settings.conditions.initialBuyRestriction)
     this.startTrading = false;

  this.lastTransaction = {
    advice: '',
    price: 0,
    fullPrice: 0
  }

  this.buyMinPersitence = this.settings.conditions.maxTimeInTrade + 1;
  this.buyTimeout = 0;
  this.sellOnTrendTurn = false;
  this.trendDurationThreashold = 15;
  this.requiredHistory = this.tradingAdvisor.historySize;
  this.downTrendDuration = 0;
  this.noTrendDuration = 0;
  // define the indicators we need
  this.addIndicator('ppo', 'PPO', this.settings);
 
  subtractFee = function(price){
     var fee = ( price*0.25 ) / 100;
     return price-fee;
  }
}

// what happens on every new candle?
method.update = function(candle) {
  if(this.buyTimeout)
    this.buyTimeout--;
}

// for debugging purposes log the last
// calculated parameters.
method.log = function() {
}

function getBuyFullPrice(price) {
   var fee = (price * 0.25) / 100;
   return price+fee;
}

function getPriceWithLoss(price, loss) {
   var lossPrice = (price * loss) / 100;
   return price - lossPrice;
}

method.check = function(candle) {
  var price = candle.close;

  var ppo = this.indicators.ppo;
  var long = ppo.result.longEMA;
  var short = ppo.result.shortEMA;
  var macd = ppo.result.macd;
  var result = ppo.result.ppo;
  var macdSignal = ppo.result.MACDsignal;
  var ppoSignal = ppo.result.PPOsignal;

  // TODO: is this part of the indicator or not?
  // if it is it should move there
  var ppoHist = result - ppoSignal;

  if(ppoHist > this.settings.thresholds.up) {

    // new trend detected
    if(this.trend.direction !== 'up'){
      this.trend = {
        duration: 0,
        persisted: false,
        direction: 'up',
        adviced: false,
        startPrice: price
      };
    }
   
    this.trend.duration++;
    this.noTrendDuration = 0;
    log.info('In uptrend since', this.trend.duration, 'candle(s): @', price );  
  } else if(ppoHist < this.settings.thresholds.down) {

    // new trend detected
    if(this.trend.direction !== 'down'){
      this.trend = {
        duration: 0,
        persisted: false,
        direction: 'down',
        adviced: false,
        startPrice: price
      };
     }
    
    this.trend.duration++;
    this.downTrendDuration = this.trend.duration;
    this.noTrendDuration = 0;
    log.info('In downtrend since', this.trend.duration, 'candle(s): @', price);  
    
  } else {
    
    this.noTrendDuration++;
    if (this.noTrendDuration > this.settings.thresholds.trendPause){
        this.downTrendDuration = 0;
        log.info('In no trend');
        this.trend = {
            duration: 0,
            persisted: false,
            direction: 'none',
            adviced: false,
            startPrice: 0
        };
    }
    else{
        log.info('Trend paused');
    }
    this.advice(); 
  }

  if (this.trend.direction=='up'){
    if(this.trend.duration >= this.settings.thresholds.upPersistence)
      this.trend.persisted = true;

    if (this.lastTransaction.advice=='long'){
       var shouldSell = false;
       if(!this.buyTimeout && this.lastTransaction.price < subtractFee(price)){
         if (this.trendDurationThreashold < this.trend.duration){
            this.sellOnTrendTurn = true;
            log.info('Sell on Trend Trurn')
         }
         else{
            shouldSell = true;
         }
       }
       if(shouldSell){
         this.trend.adviced = true;
         this.advice('short');
         this.lastTransaction.advice = 'short';
         this.lastTransaction.price = 0;
         this.lastTransaction.fullPrice = 0;
         log.info('SELL@ ', price, ' exiting trade');
      }
    }else{
      if(this.trend.persisted && !this.trend.adviced &&  this.downTrendDuration>this.settings.thresholds.downPersistence) {

         if(this.startTrading || (this.settings.conditions.initialBuyRestriction && this.settings.conditions.buyIfLessThan>=price)){
             this.startTrading = true;
             this.trend.adviced = true;
             this.advice('long');
             this.lastTransaction.advice = 'long';
             this.lastTransaction.price = price;
             this.lastTransaction.fullPrice = getBuyFullPrice(price);
             this.buyTimeout = this.buyMinPersitence;
             log.info('BUY@ ', price, ' (',this.lastTransaction.fullPrice,')' );
         }
         else{
             log.info('Should BUY@ ', price)
         }
      } else{
        this.advice();
      }
    }

  }
  else if (this.trend.direction == 'down'){
     if(this.trend.duration >= this.settings.thresholds.downPersistence)
          this.trend.persisted = true;

     if(this.sellOnTrendTurn && this.lastTransaction.fullPrice < subtractFee(price)){
         this.trend.adviced = true;
         this.advice('short');
         this.lastTransaction.advice = 'short';
         this.lastTransaction.price = 0;
         this.lastTransaction.fullPrice = 0;
         this.sellOnTrendTurn = false;
         log.info('SELL@ ', price, ' sell on trend turn'); 
     }         
     else{
         if(this.startTrading && this.trend.persisted && !this.trend.adviced && this.lastTransaction.advice!='short'){
             if(this.lastTransaction.fullPrice < subtractFee(price)){
                 this.trend.adviced = true;
                 this.advice('short');
                 this.lastTransaction.advice = 'short';
                 this.lastTransaction.price = 0;
                 this.lastTransaction.fullPrice = 0; 
                 this.sellOnTrendTurn = false;
                 log.info('SELL@ ', price), ' <',subtractFee(price);
             }
             else{
                 log.info('should SELL@ ', price);
             }
          }
          else
             this.advice();
     }

  }


}

module.exports = method;

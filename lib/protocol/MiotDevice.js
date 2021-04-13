const fs = require('fs');
const path = require('path');
const miio = require('miio');
const EventEmitter = require('events');
const MiotProperty = require('./MiotProperty.js');
const Capabilities = require('../constants/Capabilities.js');
const Properties = require('../constants/Properties.js');
const DevTypes = require('../constants/DevTypes.js');
const Constants = require('../constants/Constants.js');
const Events = require('../constants/Events.js');

const COMMAND_GET = 'get_properties';
const COMMAND_SET = 'set_properties';
const COMMAND_ACTION = 'action';

// DEVICES: http://miot-spec.org/miot-spec-v2/instances?status=all


class MiotDevice extends EventEmitter {
  constructor(miioDevice, model, deviceId, name, logger) {
    super();

    // config
    this.deviceId = deviceId;
    this.model = model;
    this.name = name;
    this.logger = logger;

    if (!this.model) {
      this.logger.error(`Missing model information!`);
    }

    //device info
    this.miioDevice = undefined;
    this.deviceInfo = {};
    this.deviceConfig = {};

    // prepare the variables
    this.capabilities = {};
    this.properties = {};

    // init the device
    this.initDevice();

    // if we construct with a miio device then we can start with the setup
    if (miioDevice) {
      this.updateMiioDevice(miioDevice);
    }

  }


  /*----------========== INIT ==========----------*/

  initDevice() {
    // init device properties
    this.logger.info(`Initializing device properties`);
    this.initDeviceProperties();
    this.logger.debug(`Device properties: ${JSON.stringify(this.properties, null, 2)}`);

    // init device capabilities
    this.logger.info(`Initializing device capabilities`);
    this.initDeviceCapabilities();
    this.logger.debug(`Device capabillities: ${JSON.stringify(this.capabilities, null, 2)}`);
  }

  initDeviceProperties() {
    // implemented by devices
  }

  initDeviceCapabilities() {
    // implemented by devices
  }


  /*----------========== SETUP ==========----------*/

  setupDevice() {
    this.logger.info(`Setting up device!`);

    // get the device info
    this.fetchDeviceInfo();

    // get the device deviceId if not specified
    if (!this.deviceId) {
      this.deviceId = this.getDeviceId();
      this.logger.info(`Did not specified. Got did: ${this.deviceId} from device!`);
    }

    // make sure we have the did, soft warning to the user if not
    this.checkDid();

    // do a device specific device setup
    this.logger.info(`Doing device specific setup`);
    this.deviceSpecificSetup();

    // initial properties fetch
    this.doInitialPropertiesFetch();

    this.logger.info(`Device setup finished! Device ready, you can now control your device!`);
  }

  fetchDeviceInfo() {
    // get the device info
    if (!this.deviceInfo) {
      this.logger.debug(`Fetching device info.`);
      this.miioDevice.management.info().then((info) => {
        this.deviceInfo = info;
        this.logger.deepDebug(`Got device info: \n ${JSON.stringify(this.deviceInfo, null, 2)}`);
      }).catch(err => {
        this.logger.debug(`Could not retrieve device info: ${err}`);
      });
    }
  }

  checkDid() {
    // make sure that we have the deviceId, not sure if this is required for local calls even on the miot protocol(maybe only required for cloud calls)
    // just a soft warning since locally the control works also without did
    try {
      if (!this.getDeviceId()) throw new Error(`Could not find deviceId for ${this.name}! This may cause issues! Please specify a deviceId in the 'config.json' file!`);
    } catch (error) {
      this.logger.warn(error);
      return;
    }
  }

  deviceSpecificSetup() {
    // implemented by devices
  }


  /*----------========== DEVICE CONTROL ==========----------*/

  disconnectAndDestroyMiioDevice() {
    if (this.miioDevice) {
      this.miioDevice.destroy();
    }
    this.miioDevice = undefined;
  }

  updateMiioDevice(newMiioDevice) {
    if (!this.miioDevice) {
      this.miioDevice = newMiioDevice;
      this.setupDevice(); // run setup only for the first time
    } else {
      this.miioDevice = newMiioDevice;
      this.logger.info(`Reconnected to device!`);
    }
  }


  /*----------========== DEVICE LIFECYCLE ==========----------*/

  doInitialPropertiesFetch() {
    this.logger.info(`Doing initial properties fetch`);
    // initial properties fetch
    this.requestAllProperties().then(() => {
      // on initial connection log the retrieved properties
      this.logger.debug(`Got initial device properties: \n ${JSON.stringify(this.getAllPropNameValues(), null, 2)}`);
      this.gotInitialPropertiesFromDevice();
    }).catch(err => {
      this.logger.debug(`Error on initial property request! ${err}`);
    });
  }

  async pollProperties() {
    if (this.isConnected()) {
      return this.requestAllProperties();
    }
    return new Promise((resolve, reject) => {
      reject(new Error('Device not connected'));
    });
  }

  gotInitialPropertiesFromDevice() {
    // log the total use time if the device supports it
    if (this.supportsUseTimeReporting()) {
      this.logger.info(`Device total use time: ${this.getUseTime()} minutes.`);
    }

    // devices actions
    this.initialPropertyFetchDone();
  }

  initialPropertyFetchDone() {
    // implemented by devices
  }


  /*----------========== INFO ==========----------*/

  isConnected() {
    return this.miioDevice !== undefined;
  }

  getModel() {
    if (this.isConnected()) {
      return this.miioDevice.miioModel;
    }
    return this.model;
  }

  getType() {
    return DevTypes.UNKNOWN;
  }

  getDeviceInfo() {
    return this.deviceInfo;
  }

  getAllCapabilities() {
    return this.capabilities;
  }

  getAllProperties() {
    return this.properties;
  }

  getAllPropNameValues() {
    // only readable properties
    let readablePropKeys = Object.keys(this.properties).filter(key => this.properties[key].isReadable());
    let propNameValues = readablePropKeys.map(key => this.properties[key].getNameValObj());
    return propNameValues;
  }

  getDeviceId() {
    if (this.isConnected()) {
      return this.miioDevice.id.replace(/^miio:/, '');
    }
    return this.deviceId;
  }


  /*----------========== METADATA ==========----------*/

  addCapability(name, value) {
    this.capabilities[name] = value;
  }

  addProperty(name, siid, piid, format, access, unit, valueRange, valueList) {
    if (!name) {
      this.logger.warn(`Missing name! Cannot create property!`);
      return;
    }

    if (!siid || !piid) {
      this.logger.warn(`Missing siid or piid for ${name} property! Cannot create!`);
      return;
    }

    let newProp = new MiotProperty(name, siid, piid, format, access, unit, valueRange, valueList);
    this.properties[name] = newProp;
    return newProp;
  }

  hasProperty(propName) {
    return this.properties[propName] !== undefined;
  }


  /*----------========== PROPERTY HELPERS ==========----------*/

  getProperty(propName) {
    let prop = this.properties[propName];
    if (prop) {
      return prop;
    }
    this.logger.warn(`The property ${propName} was not found on this deivce!`);
    return null;
  }

  getPropertyValue(propName) {
    let prop = this.getProperty(propName);
    if (prop) {
      return prop.getValue();
    }
    return undefined;
  }

  getSafePropertyValue(propName) {
    let prop = this.getProperty(propName);
    if (prop) {
      return prop.getSafeValue();
    }
    return 0;
  }

  getPropertyValueRange(propName) {
    if (this.hasProperty(propName)) {
      let prop = this.getProperty(propName);
      if (prop.hasValueRange()) {
        return prop.getValueRange();
      }
    }
    return [];
  }

  getPropertyValueList(propName) {
    if (this.hasProperty(propName)) {
      let prop = this.getProperty(propName);
      if (prop.hasValueList()) {
        return prop.getValueList();
      }
    }
    return [];
  }

  setPropertyValue(propName, value) {
    let prop = this.getProperty(propName);
    if (prop) {
      let propRange = prop.getValueRange();
      if (propRange != null && propRange.length > 1) {
        let low = propRange[0];
        let high = propRange[1];
        if (value > high) {
          this.logger.debug(`Trying to set ${prop.getName()} property with an out of range value: ${value}. Adjusting value to max: ${high}`);
          value = high;
        } else if (value < low) {
          this.logger.debug(`Trying to set ${prop.getName()} property with an out of range value: ${value}. Adjusting value to min: ${low}`);
          value = low;
        }
      }
      if (prop.getValue() !== value) {
        this.setProperty(prop, value);
      } else {
        this.logger.debug(`Property ${prop.getName()} seems to have already the value: ${value}. Set not needed! Skipping...`);
      }
    }
  }


  /*----------========== PROTOCOL ==========----------*/

  // get only properties which are reabadle
  getAllReadableProps() {
    let tmpAllReadableProps = {};

    let allPropKeys = Object.keys(this.properties);
    allPropKeys.forEach((key) => {
      let tmpProp = this.properties[key];
      if (tmpProp && tmpProp.isReadable()) {
        tmpAllReadableProps[key] = tmpProp;
      }
    });
    return tmpAllReadableProps;
  }

  // updates the property value with the value retrieved from the device
  updatePropertyValueFromDevice(result, propName, returnObj) {
    if (returnObj.code === 0) {
      this.getProperty(propName).setValue(returnObj.value);
      result[propName] = returnObj.value;
    } else if (returnObj.code !== 0 || returnObj.value === undefined) {
      this.logger.debug(`Error while parsing response from device for property ${propName}. Response object: ${JSON.stringify(returnObj)}`);
    }
  }

  // actions
  async sendCommnd(prop, value) {
    if (prop) {
      if (this.isConnected()) {
        let cmdDef = prop.getWriteProtocolObjForDid(this.deviceId, value);
        this.logger.deepDebug(`Send command! RAW: ${JSON.stringify(cmdDef)}`);
        return this.miioDevice.call(COMMAND_SET, [cmdDef]).then(result => {
          this.logger.debug(`Successfully send command ${prop.getName()} with value ${value}! Result: ${JSON.stringify(result)}`);
        }).catch(err => {
          this.logger.debug(`Error while executing command ${prop.getName()} with value ${value}! ${err}`);
        });
      } else {
        return this.createErrorPromise(`Cannot execute command ${prop.getName()} with value ${value}! Device not connected!`);
      }
    } else {
      return this.createErrorPromise(`Missing property! Cannot execute the command!`);
    }
  }

  async setProperty(prop, value) {
    if (prop) {
      if (this.isConnected()) {
        let propDef = prop.getWriteProtocolObjForDid(this.deviceId, value);
        this.logger.deepDebug(`Set ${prop.getName()} property request! RAW: ${JSON.stringify(propDef)}`);
        return this.miioDevice.call(COMMAND_SET, [propDef]).then(result => {
          this.logger.debug(`Successfully set property ${prop.getName()} to value ${value}! Result: ${JSON.stringify(result)}`);
          // do not wait for poll, update the local prop and notifiy listeners after successful set
          prop.setValue(value);
          this.emit(Events.DEVICE_PROPERTY_UPDATED, prop);
        }).catch(err => {
          this.logger.debug(`Error while setting property ${prop.getName()} to value ${value}! ${err}`);
        });
      } else {
        return this.createErrorPromise(`Cannot set property ${prop.getName()} to value ${value}! Device not connected!`);
      }
    } else {
      return this.createErrorPromise(`Missing property! Cannot set the value!`);
    }
  }

  async requestAllProperties() {
    if (this.isConnected()) {
      let allReadableProps = this.getAllReadableProps();
      let readablePropKeys = Object.keys(allReadableProps);
      let allReadableProtcolProps = readablePropKeys.map(key => this.properties[key].getReadProtocolObjForDid(this.deviceId));
      return this.miioDevice.call(COMMAND_GET, allReadableProtcolProps)
        .then(result => {
          const obj = {};
          for (let i = 0; i < result.length; i++) {
            this.updatePropertyValueFromDevice(obj, readablePropKeys[i], result[i]);
          }
          return obj;
        });
      // no catch here, catch has to be handled by caller, in that case the property polling
    } else {
      return this.createErrorPromise(`Cannot poll all properties! Device not connected!`);
    }
  }

  // currently not used, but can be used to retrieve a single property value
  async requestProperty(prop) {
    if (prop) {
      if (this.isConnected()) {
        if (prop.isReadable()) {
          let propDef = prop.getReadProtocolObjForDid(this.deviceId);
          this.logger.deepDebug(`Request ${prop.getName()} property! RAW: ${JSON.stringify(propDef)}`);
          return this.miioDevice.call(COMMAND_GET, [propDef])
            .then(result => {
              this.logger.debug(`Successfully updated property ${prop} value! Result: ${JSON.stringify(result)}`);
              const obj = {};
              this.updatePropertyValueFromDevice(obj, prop.getName(), result[0]);
              this.emit(Events.DEVICE_PROPERTY_UPDATED, prop);
              return obj;
            }).catch(err => {
              this.logger.debug(`Error while requesting property ${prop.getName()}! ${err}`);
            });
        } else {
          return this.createErrorPromise(`Cannot update property ${prop.getName()}! Property is write only!`);
        }
      } else {
        return this.createErrorPromise(`Cannot update property ${prop.getName()}! Device not connected!`);
      }
    } else {
      return this.createErrorPromise(`Missing property! Cannot execute read request!`);
    }
  }


  /*----------========== HELPERS ==========----------*/

  createErrorPromise(msg) {
    return new Promise((resolve, reject) => {
      reject(new Error(msg));
    }).catch(err => {
      this.logger.debug(err);
    });
  }


}

module.exports = MiotDevice;
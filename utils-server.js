RPS._noop = function () {
};

RPS._testMongo = function (doc, selector) {
    var matcher = new Minimongo.Matcher(selector);
    var match = matcher.documentMatches(doc);
    return match.result;
};

RPS._containsOperators = function (modifier) {
    return _.some(modifier, function (value, operator) {
        return /^\$/.test(operator);
    });
};

RPS._containsOnlySetters = function (modifier) {
    return !_.difference(_.keys(modifier), ['$set', '$unset']).length;
};

RPS._isSimpleModifier = function (modifier) {
    return !RPS._containsOperators(modifier) || RPS._containsOnlySetters(modifier);
};

RPS._isPlainObject = function (object) {
    return _.isObject(object) && object.constructor === Object && !_.isArguments(object);
};

RPS._property = function (object, key) {
    var property = object,
        levels = key.split('.'),
        valueIsHere = arguments.length > 2;

    if (!valueIsHere) {
        // Get property
        _.each(levels, function (key) {
            property = _.isObject(property) ? property[key] : undefined;
        });

        return property;
    } else {
        // Set property
        _.each(_.initial(levels), function (level) {
            property[level] = _.isObject(property[level]) ? property[level] : {};
            property = property[level];
        });

        property[_.last(levels)] = arguments[2];

        return object;
    }
};

RPS._deepExtend = function (dest) {
    _.each(Array.prototype.slice.call(arguments, 1), function (src) {
        _.each(src, function (value, key) {
            //console.log('RPS._deepExtend; value, key:', value, key);
            value = _.clone(value);
            if (RPS._isPlainObject(value)) {
                //console.log('RPS._deepExtend; _.isObject(value):', _.isObject(value));
                if (RPS._isPlainObject(dest[key]) && !value.__RPS__cancelDeepExtend) {
                    //console.log('RPS._deepExtend → RPS._deepExtend');
                    RPS._deepExtend(dest[key], value);
                } else {
                    delete value.__RPS__cancelDeepExtend;
                    dest[key] = value;
                }
            } else {
                dest[key] = value;
            }
        });
    });

    return dest;
};

RPS._modifyDoc = function (doc, modifier) {
    //console.log('RPS._modifyDoc; doc, modifier:', doc, modifier);
    if (!RPS._containsOperators(modifier)) {
        return modifier && modifier._id ? modifier : _.extend({}, modifier, {_id: doc._id});
    } else if (RPS._containsOnlySetters(modifier)) {
        var setter = {},
            unsetter = {};

        _.each(modifier.$set, function (value, key) {
            if (RPS._isPlainObject(value)) {
                value.__RPS__cancelDeepExtend = 1;
            }
            RPS._property(setter, key, value);
        });

        _.each(modifier.$unset, function (value, key) {
            RPS._property(unsetter, key, undefined);
        });

        //console.log('RPS._modifyDoc; setter, unsetter:', setter, unsetter);

        return RPS._deepExtend({}, doc, setter, unsetter);
    }
};

// Lets Metro resolve the SDK from the parent folder (`file:..`) while using a
// single copy of react and react-native: the example's own node_modules.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "..")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
config.resolver.disableHierarchicalLookup = true;
module.exports = config;

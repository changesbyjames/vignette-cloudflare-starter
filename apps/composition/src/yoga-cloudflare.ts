import initYoga from "yoga-wasm-web";
import yogaModule from "yoga-wasm-web/dist/yoga.wasm";

type LooseRecord = Record<string, unknown>;
type LooseFunction = (...args: unknown[]) => unknown;

const Yoga = (await initYoga(yogaModule)) as unknown as LooseRecord;
Yoga.BOX_SIZING_BORDER_BOX = 0;
Yoga.ERRATA_NONE = 0;
const Config = Yoga.Config as { create: () => LooseRecord };
const Node = Yoga.Node as {
  create: (config?: LooseRecord) => LooseRecord;
  createDefault: () => LooseRecord;
  createWithConfig: (config: LooseRecord) => LooseRecord;
};

const createConfig = Config.create.bind(Config);
Config.create = () => {
  const config = createConfig();
  config.setErrata = () => undefined;
  return config;
};

const createNode = Node.create.bind(Node);
const createDefaultNode = Node.createDefault.bind(Node);
const createNodeWithConfig = Node.createWithConfig.bind(Node);
Node.create = (config) => decorateNode(config === undefined ? createNode() : createNodeWithConfig(config));
Node.createDefault = () => decorateNode(createDefaultNode());
Node.createWithConfig = (config) => decorateNode(createNodeWithConfig(config));

function decorateNode(node: LooseRecord): LooseRecord {
  node.setBoxSizing = () => undefined;
  node.setPositionAuto = (edge: unknown) => (node.setPosition as LooseFunction)(edge, "auto");
  for (const method of [
    "setWidth",
    "setHeight",
    "setMinWidth",
    "setMinHeight",
    "setMaxWidth",
    "setMaxHeight",
    "setAspectRatio",
    "setFlexGrow",
    "setFlexShrink",
    "setFlexBasis",
  ]) {
    const apply = (node[method] as LooseFunction).bind(node);
    node[method] = (value: unknown) => (value === undefined ? undefined : apply(value));
  }
  return node;
}

export default Yoga;

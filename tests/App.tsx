import React from 'react';
import {
  View,
  Text,
  ScrollView,
} from 'react-native';
import { RunnableTest } from './utils'
import TestComponent from './components/TestComponent';
import styles from './styles';
import { tests } from './tests';
import { SQLiteCache } from './dist';
import { Schema } from '@orbit/data';

interface Props {}
interface State {
  tests: RunnableTest[];
}

export default class App extends React.Component <Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      tests: [],
    };
  }

  addNextTest () {
    const index = this.state.tests.length;
    if (index < tests.length) {
      const test = tests[index];
      test.emitter.on('done', () => {
        this.addNextTest();
      });
      test.emitter.on('failed', () => {
        this.addNextTest();
      });
      this.setState({ tests: [...this.state.tests].concat(test) });
    }
  }

  componentDidMount () {
    // TODO Handle test suites (before/after suite, beforeEach/afterEach unit)
    // This should go in the before() CacheTest suite
    const schema = new Schema();
    const cache = new SQLiteCache({ schema });
    cache.openDB()
      .then(() => cache.deleteDB())
      .then(() => this.addNextTest());
    }

  render () {
    return (
      <View
        style={styles.root}>
        <View
          style={{ ...styles.row, ...styles.header_row }}>
          <Text style={{ ...styles.cell, ...styles.header_cell, ...styles.label_cell }}>Label</Text>
          <Text style={{ ...styles.cell, ...styles.header_cell, ...styles.result_cell }}>Result</Text>
          <Text style={{ ...styles.cell, ...styles.header_cell, ...styles.duration_cell }}>Duration</Text>
        </View>
        <ScrollView>
          {this.state.tests.map((test: RunnableTest, key: number) => 
            <TestComponent
              key={key}
              test={test}
              />
          )}
        </ScrollView>
      </View>
    );
  }
};

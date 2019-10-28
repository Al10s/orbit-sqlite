import React from 'react';
import {
  View,
  Text,
  ScrollView,
} from 'react-native';
import { RunnableTestUnit, RunnableTestSuite, TestContext, getFormattedDuration } from '../utils';
import styles from '../styles';
import UnitComponent from './UnitComponent';
import moment from 'moment';

interface Props {
  suite: RunnableTestSuite<TestContext>;
}
interface State {
  units: RunnableTestUnit<TestContext>[];
  successCount: number;
  failureCount: number;
  running: boolean;
  duration: string;
}

export default class SuiteComponent extends React.Component <Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      units: [],
      successCount: 0,
      failureCount: 0,
      running: true,
      duration: '',
    };
  }

  addNextTest () {
    const index = this.state.units.length;
    if (index < this.props.suite.units.length) {
      const test = this.props.suite.units[index];

      const onUnitSuccess = () => this.setState({ successCount: (this.state.successCount + 1) })
      const onUnitFailure = () => this.setState({ failureCount: (this.state.failureCount + 1) })
      const onDone = () => {
        test.emitter.off('success', onUnitSuccess);
        test.emitter.off('failure', onUnitFailure);
        test.emitter.off('done', onDone);
        this.addNextTest();
      }

      test.emitter.on('success', onUnitSuccess);
      test.emitter.on('failure', onUnitFailure);
      test.emitter.on('done', onDone);

      this.setState({ units: [...this.state.units].concat(test) });
    }
    else {
      this.props.suite.emitter.trigger('suite done');
    }
  }

  async componentDidMount () {
    const start = moment();
    await this.props.suite.before();
    this.addNextTest();

    const onSuiteDone = async () => {
      await this.props.suite.after();

      this.setState({ running: false, duration: getFormattedDuration(start, moment()) })
      this.props.suite.emitter.off('suite done', onSuiteDone);
      this.props.suite.emitter.trigger('done', { success: this.state.successCount, failure: this.state.failureCount });
    }

    this.props.suite.emitter.on('suite done', onSuiteDone);
  }

  render () {
    return (
      <View
        style={styles.root}>
        <Text style={styles.suite_title}>{this.props.suite.name}</Text>
        <View
          style={{ ...styles.row, ...styles.header_row }}>
          <Text style={{ ...styles.cell, ...styles.header_cell, ...styles.label_cell }}>Label</Text>
          <Text style={{ ...styles.cell, ...styles.header_cell, ...styles.result_cell }}>Result</Text>
          <Text style={{ ...styles.cell, ...styles.header_cell, ...styles.duration_cell }}>Duration</Text>
        </View>
        <ScrollView>
          {this.state.units.map((test: RunnableTestUnit<TestContext>, key: number) => 
            <UnitComponent
              key={key}
              test={test}
              beforeEach={this.props.suite.beforeEach}
              afterEach={this.props.suite.afterEach}
              />
          )}
        </ScrollView>
        {this.state.running ||
          <View style={styles.suite_summary}>
            <Text style={styles.suite_summary_text}>
              {this.props.suite.name} suite done in {this.state.duration}.
            </Text>
            {!!this.state.successCount &&
              <Text style={{ ...styles.suite_summary_text, ...styles.success }}>
                {this.state.successCount} test(s) passed.
              </Text>
            }
            {!!this.state.failureCount &&
              <Text style={{ ...styles.suite_summary_text, ...styles.failure }}>
                {this.state.failureCount} test(s) failed.
              </Text>
            }
          </View>
        }
      </View>
    );
  }
};

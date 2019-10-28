import React from 'react';
import {
  View, ScrollView, Alert,
} from 'react-native';
import { RunnableTestSuite, TestContext, getFormattedDuration } from './utils'
import styles from './styles';
import SuiteComponent from './components/SuiteComponent';
import { suites } from './tests';
import moment, { Moment } from 'moment';

interface Props {}
interface State {
  suites: RunnableTestSuite<TestContext>[];
  success: number;
  failure: number;
}

export default class App extends React.Component <Props, State> {
  start: Moment;
  constructor(props: Props) {
    super(props);
    this.state = {
      suites: [],
      success: 0,
      failure: 0,
    };
    this.start = moment()
  }

  addNextSuite () {
    const index = this.state.suites.length;
    if (index < suites.length) {
      const suite = suites[index];
      suite.emitter.on('done', ({ success, failure }) => {
        this.setState({
          success: this.state.success + success,
          failure: this.state.failure + failure,
        });
        this.addNextSuite();
      });
      this.setState({ suites: [...this.state.suites].concat(suite) });
    }
    else {
      const success = this.state.success;
      const failure = this.state.failure;
      const total = success + failure;
      const formattedDuration = getFormattedDuration(this.start, moment());
      const successRatio = Math.floor(100 * success / total);
      const failureRatio = Math.floor(100 * failure / total);
      Alert.alert(
        'Tests done',
        `All ${total} tests have been done in ${formattedDuration}.` + 
        `${success ? `\n${success} have succeeded (${successRatio}%).` : ''}` + 
        `${failure ? `\n${failure} have failed (${failureRatio}%).` : ''}`
      )
    }
  }

  componentDidMount () {
    this.addNextSuite();
  }

  render () {
    return (
      <View
        style={styles.root}>
        <ScrollView>
          {this.state.suites.map((suite: RunnableTestSuite<TestContext>, key: number) => 
            <SuiteComponent
              key={key}
              suite={suite}
              />
          )}
        </ScrollView>
      </View>
    );
  }
};
